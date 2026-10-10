// Replace this service only after the FastAPI contract is confirmed.
function createDemoReply() {
  return {
    mode: "demo",
    reply: "Test reply: Express received your message. The AI service is not connected yet, so no medical analysis has been performed.",
  };
}

module.exports = { createDemoReply };
