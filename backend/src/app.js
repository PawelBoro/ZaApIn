const express = require("express");
const path = require("path");

const helmet = require("helmet");

const app = express();
app.use(helmet());

/*
Static files - Publiczne pliki statyczne
*/
app.use(express.static(path.join(__dirname, "public")));

/*
Trasowanie
 */
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", (req, res) => {
  res.status(404).json({ title: "Not Found", status: 404 });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "view", "not_found.html"));
});

module.exports = app;
