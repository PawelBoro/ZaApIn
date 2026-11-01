const express = require("express");
const { z } = require("zod");
const pool = require("../db");
const { problem, validationErrors } = require("../lib/problem");
const { parseId, parseBigId } = require("../lib/ids");
const { requireSensor, unauthorized } = require("../middleware/sensorAuth");

const COLUMNS = "id, series_id, sensor_id, value, ts";
// A sensor's clock may run a little ahead; anything later is rejected.
const MAX_FUTURE_MS = 5 * 60 * 1000;
// The only text that goes into ORDER BY; never taken from the request.
const SORT_DIRECTIONS = { timestamp: "ASC", "-timestamp": "DESC" };

// "1,3" -> [1, 3]; any id that parseId rejects makes the whole list invalid.
const seriesIds = z.string().transform((value, ctx) => {
  const ids = value.split(",").map(parseId);
  if (ids.includes(null)) {
    ctx.addIssue({ code: "custom", message: "Must be comma-separated positive integer ids." });
    return z.NEVER;
  }
  return ids;
});

// Query values are strings; a repeated parameter becomes an array and fails.
const listQuerySchema = z.object({
  series: seriesIds.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  sort: z.enum(["timestamp", "-timestamp"]).default("timestamp"),
  limit: z.string().regex(/^\d+$/, "Must be an integer.")
    .transform(Number).pipe(z.number().min(1).max(10000)).default(1000),
});

const measurementSchema = z.object({
  // zod 4 rejects Infinity and NaN, so JSON like 1e999 is a 400 too.
  value: z.number(),
  // ISO 8601 with a timezone (Z or ±hh:mm), so the instant is unambiguous.
  timestamp: z.iso.datetime({ offset: true }).optional(),
});

function toMeasurement(row) {
  return {
    // BIGSERIAL arrives as a string; ids stay below 2^53, so Number is exact.
    id: Number(row.id),
    seriesId: row.series_id,
    sensorId: row.sensor_id,
    value: row.value,
    timestamp: row.ts,
  };
}

function notFound(res) {
  return problem(res, 404, "Not Found", "Measurement not found.");
}

// Measurements are never changed or deleted; they go only with their series.
function methodNotAllowed(allow) {
  return (req, res) => {
    res.set("Allow", allow);
    problem(res, 405, "Method Not Allowed", "Measurements cannot be changed or deleted.");
  };
}

const router = express.Router();

router.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return problem(res, 400, "Bad Request", "Invalid query parameters.", validationErrors(parsed.error));
  }
  const q = parsed.data;

  // Each filter adds a fixed SQL fragment; values only travel as $n parameters.
  const where = [];
  const params = [];
  if (q.series) {
    params.push(q.series);
    where.push(`series_id = ANY($${params.length}::int[])`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`ts >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`ts <= $${params.length}`);
  }
  params.push(q.limit);
  const dir = SORT_DIRECTIONS[q.sort];
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM measurements
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ts ${dir}, id ${dir}
     LIMIT $${params.length}`,
    params
  );
  res.json(rows.map(toMeasurement));
});

router.get("/:id", async (req, res) => {
  const id = parseBigId(req.params.id);
  if (id === null) return notFound(res);
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM measurements WHERE id = $1`, [id]);
  if (rows.length === 0) return notFound(res);
  res.json(toMeasurement(rows[0]));
});

router.post("/", requireSensor, async (req, res) => {
  const parsed = measurementSchema.safeParse(req.body);
  if (!parsed.success) {
    return problem(res, 400, "Bad Request", "Invalid measurement.", validationErrors(parsed.error));
  }
  const { value, timestamp } = parsed.data;
  const ts = timestamp ? new Date(timestamp) : new Date();
  if (ts.getTime() > Date.now() + MAX_FUTURE_MS) {
    return problem(res, 422, "Unprocessable Content", "Timestamp is in the future.",
      [{ field: "timestamp", message: "Must not be more than 5 minutes after the server time." }]);
  }
  const { id: sensorId, seriesId } = req.sensor;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR SHARE pairs with the FOR UPDATE in PUT /api/series/:id: the range
    // cannot change between this check and the insert.
    const found = await client.query(
      "SELECT min_value, max_value FROM series WHERE id = $1 FOR SHARE",
      [seriesId]
    );
    // The series (and with it the sensor) was deleted after the key check.
    if (found.rowCount === 0) {
      await client.query("ROLLBACK");
      return unauthorized(res);
    }
    const { min_value: min, max_value: max } = found.rows[0];
    if (value < min || value > max) {
      await client.query("ROLLBACK");
      console.warn(
        `Measurement rejected: sensor ${sensorId}, series ${seriesId}, value ${value} outside [${min}, ${max}]`
      );
      return problem(res, 422, "Unprocessable Content", "Value is outside the series range.",
        [{ field: "value", message: `Must be between ${min} and ${max}.` }]);
    }
    const { rows } = await client.query(
      `INSERT INTO measurements (series_id, sensor_id, value, ts)
       VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
      [seriesId, sensorId, value, ts]
    );
    await client.query("UPDATE sensors SET last_measurement_at = now() WHERE id = $1", [sensorId]);
    await client.query("COMMIT");
    res.status(201).location(`/api/measurements/${rows[0].id}`).json(toMeasurement(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

const notAllowedOnList = methodNotAllowed("GET, POST");
const notAllowedOnOne = methodNotAllowed("GET");
router.route("/").put(notAllowedOnList).patch(notAllowedOnList).delete(notAllowedOnList);
router.route("/:id").put(notAllowedOnOne).patch(notAllowedOnOne).delete(notAllowedOnOne);

module.exports = router;
