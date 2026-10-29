const express = require("express");
const path = require("path");

const helmet = require("helmet");
const negotiation = require("./middleware/negotiation");
const { apiNotFound, errorHandler } = require("./middleware/errors");
const authRouter = require("./routes/auth");

const app = express();
app.use(helmet());

/*
Static files - Publiczne pliki statyczne
*/
app.use(express.static(path.join(__dirname, "public")));

/*
Trasowanie
 */
app.use("/api", negotiation);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);

app.use("/api", apiNotFound);

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "view", "not_found.html"));
});

app.use(errorHandler);

module.exports = app;
