const express = require("express");
const { z } = require("zod");
const pool = require("../db");
const { problem, validationErrors } = require("../lib/problem");
const { parseId } = require("../lib/ids");
const { requireAdmin } = require("../middleware/auth");

const COLUMNS = "id, name, min_value, max_value, color, icon, unit";

const seriesSchema = z.object({
  name: z.string().min(1).max(100),
  minValue: z.number(),
  maxValue: z.number(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Must be a #RRGGBB colour."),
  icon: z.string().max(50).nullish(),
  unit: z.string().max(20).nullish(),
});

function toSeries(row) {
  return {
    id: row.id,
    name: row.name,
    minValue: row.min_value,
    maxValue: row.max_value,
    color: row.color,
    icon: row.icon || null,
    unit: row.unit || null,
  };
}

function notFound(res) {
  return problem(res, 404, "Not Found", "Series not found.");
}

// Wrong shape or types -> 400; valid types but min >= max -> 422.
// Sends the error response itself and returns null in that case.
function parseSeries(req, res) {
  const parsed = seriesSchema.safeParse(req.body);
  if (!parsed.success) {
    problem(res, 400, "Bad Request", "Invalid series.", validationErrors(parsed.error));
    return null;
  }
  const s = parsed.data;
  if (s.minValue >= s.maxValue) {
    problem(res, 422, "Unprocessable Content", "minValue must be less than maxValue.",
      [{ field: "minValue", message: "Must be less than maxValue." }]);
    return null;
  }
  return { ...s, icon: s.icon || null, unit: s.unit || null };
}

const router = express.Router();

router.get("/", async (req, res) => {
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM series ORDER BY id`);
  res.json(rows.map(toSeries));
});

router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return notFound(res);
  const { rows } = await pool.query(`SELECT ${COLUMNS} FROM series WHERE id = $1`, [id]);
  if (rows.length === 0) return notFound(res);
  res.json(toSeries(rows[0]));
});

router.post("/", requireAdmin, async (req, res) => {
  const s = parseSeries(req, res);
  if (!s) return;
  const { rows } = await pool.query(
    `INSERT INTO series (name, min_value, max_value, color, icon, unit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [s.name, s.minValue, s.maxValue, s.color, s.icon, s.unit]
  );
  res.status(201).location(`/api/series/${rows[0].id}`).json(toSeries(rows[0]));
});

router.put("/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return notFound(res);
  const s = parseSeries(req, res);
  if (!s) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Locking the row makes concurrent measurement inserts for this series
    // wait, so none can slip in between the range check and the update.
    const found = await client.query("SELECT id FROM series WHERE id = $1 FOR UPDATE", [id]);
    if (found.rowCount === 0) {
      await client.query("ROLLBACK");
      return notFound(res);
    }
    const { rows: [{ outside }] } = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM measurements WHERE series_id = $1 AND (value < $2 OR value > $3)
       ) AS outside`,
      [id, s.minValue, s.maxValue]
    );
    if (outside) {
      await client.query("ROLLBACK");
      return problem(res, 409, "Conflict", "Existing measurements fall outside the new range.");
    }
    const { rows } = await client.query(
      `UPDATE series SET name = $2, min_value = $3, max_value = $4, color = $5, icon = $6, unit = $7
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, s.name, s.minValue, s.maxValue, s.color, s.icon, s.unit]
    );
    await client.query("COMMIT");
    res.json(toSeries(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// The FK cascade removes the series' sensors and measurements.
router.delete("/:id", requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (id === null) return notFound(res);
  const { rowCount } = await pool.query("DELETE FROM series WHERE id = $1", [id]);
  if (rowCount === 0) return notFound(res);
  res.status(204).end();
});

module.exports = router;
