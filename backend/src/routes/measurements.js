const express = require("express");
const { z } = require("zod");
const pool = require("../db");
const { problem, validationErrors } = require("../lib/problem");
const { requireSensor, unauthorized } = require("../middleware/sensorAuth");

const COLUMNS = "id, series_id, sensor_id, value, ts";
// A sensor's clock may run a little ahead; anything later is rejected.
const MAX_FUTURE_MS = 5 * 60 * 1000;

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

const router = express.Router();

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

module.exports = router;
