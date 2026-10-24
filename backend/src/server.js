#!/usr/bin/env node
const express = require("express");
const app = express();
const port = 3000;
const path = require("path");

/*
Static files - Publiczne pliki statyczne
*/
app.use(express.static(path.join(__dirname, "public")));
/*
Trasowanie
 */
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/test", (req, res) => {
  res.send("Hello Test World!");
});

app.get("/*", (req, res) => unexpected_route_handler);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
