let pipeline: any = null;

async function getPipeline() {
  if (pipeline) return pipeline;

  const { pipeline: createPipeline } = await import("@huggingface/transformers");
  pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "fp32",
  });
  return pipeline;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}
