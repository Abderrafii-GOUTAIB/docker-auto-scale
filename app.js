const express = require("express");
const app = express();

const INSTANCE_NAME = process.env.INSTANCE_NAME || "unknown";
const PORT = process.env.PORT || 3000;

let requestCount = 0;

app.get("/", (req, res) => {
  requestCount++;
  res.json({
    instance: INSTANCE_NAME,
    message: "Hello!",
    requestCount,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", instance: INSTANCE_NAME });
});

app.listen(PORT, () => {
  console.log(`✅ ${INSTANCE_NAME} sur port ${PORT}`);
});
