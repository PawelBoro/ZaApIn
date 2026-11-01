const crypto = require("node:crypto");
const express = require("express");
const { z } = require("zod");
const pool = require("../db");
const { problem, validationErrors } = require("../lib/problem");
const { sha256 } = require("../lib/hash");
const { MAX_INT, parseId } = require("../lib/ids");
const { requireAdmin } = require("../middleware/auth");

// Never select api_key_hash, so it cannot end up in a response by accident.
const COLUMNS = "id, name, series_id, created_at, last_measurement_at";

const sensorSchema = z.object({
  name: z.string().min(1).max(100),
  // Capped at MAX_INT so a huge id is a 400, not an "integer out of range" 500.
  seriesId: z.number().int().positive().max(MAX_INT),
});

function toSensor(row) {
  return {
    id: row.id,
    name: row.name,
    seriesId: row.series_id,
    createdAt: row.created_at,
    lastMeasurementAt: row.last_measurement_at,
  };
}

function notFound(res) {
  return problem(res, 404, "Not Found", "Sensor not found.");
}

const router = express.Router();

// Every sensor operation is for the administrator; checked before the body,
// so a request without a token gets 401 even if its body is invalid.
router.use(requireAdmin);

router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM sensors WHERE deleted_at IS NULL ORDER BY id`
  );
  res.json(rows.map(toSensor));
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return notFound(res);
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM sensors WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (rows.length === 0) return notFound(res);
  res.json(toSensor(rows[0]));
});

router.post("/", async (req, res) => {
  const parsed = sensorSchema.safeParse(req.body);
  if (!parsed.success) {
    return problem(res, 400, "Bad Request", "Invalid sensor.", validationErrors(parsed.error));
  }
  const { name, seriesId } = parsed.data;

  // The key is shown once; only its hash is stored.
  const apiKey = crypto.randomBytes(32).toString("hex");
  // Inserting from the series row checks that it exists in the same statement,
  // so it cannot be deleted between a separate check and the insert.
  const { rows } = await pool.query(
    `INSERT INTO sensors (name, series_id, api_key_hash)
     SELECT $1, id, $3 FROM series WHERE id = $2
     RETURNING ${COLUMNS}`,
    [name, seriesId, sha256(apiKey)]
  );
  if (rows.length === 0) {
    return problem(res, 422, "Unprocessable Content", "Series does not exist.",
      [{ field: "seriesId", message: "Series does not exist." }]);
  }
  res.status(201).location(`/api/sensors/${rows[0].id}`).json({ ...toSensor(rows[0]), apiKey });
});

// Soft delete: the key stops working at once, the measurements stay.
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return notFound(res);
  const { rowCount } = await pool.query(
    "UPDATE sensors SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL",
    [id]
  );
  if (rowCount === 0) return notFound(res);
  res.status(204).end();
});

module.exports = router;
