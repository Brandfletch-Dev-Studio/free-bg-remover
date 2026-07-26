import { removeBackground } from "@imgly/background-removal";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Read the uploaded file from the request body
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const imageBuffer = Buffer.concat(chunks);

    if (imageBuffer.length === 0) {
      return res.status(400).json({ error: "No image provided" });
    }

    // Maximum 10MB
    if (imageBuffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: "Image too large (max 10MB)" });
    }

    // Convert buffer to blob for @imgly/background-removal
    const imageBlob = new Blob([imageBuffer]);

    // Remove the background
    const resultBlob = await removeBackground(imageBlob, {
      model: "isnet_fp16", // smaller model for faster server-side processing
      output: { format: "image/png" },
    });

    // Convert result blob to buffer
    const resultBuffer = Buffer.from(await resultBlob.arrayBuffer());

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", resultBuffer.length);
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).send(resultBuffer);
  } catch (err) {
    console.error("Background removal error:", err);
    return res.status(500).json({ error: "Failed to process image: " + err.message });
  }
}
