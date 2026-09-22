import { describe, expect, it } from "vitest";
import {
  createLLMClientFromEnv,
  LLMError,
  OpenAICompatibleClient,
  parseJsonLoose,
} from "@/core/llm/client";
import { FakeLLM } from "@/core/llm/fake";

describe("createLLMClientFromEnv", () => {
  it("selects the Groq provider and its defaults", () => {
    const client = createLLMClientFromEnv({
      LLM_PROVIDER: "groq",
      GROQ_API_KEY: "gsk_test",
    });
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
    expect(client.model).toBe("llama-3.3-70b-versatile");
  });

  it("honours GROQ_BASE_URL and GROQ_MODEL overrides", () => {
    const client = createLLMClientFromEnv({
      LLM_PROVIDER: "groq",
      GROQ_API_KEY: "gsk_test",
      GROQ_MODEL: "openai/gpt-oss-120b",
      GROQ_BASE_URL: "https://api.groq.com/openai/v1",
    });
    expect(client.model).toBe("openai/gpt-oss-120b");
  });

  it("defaults to groq when only GROQ_API_KEY is present", () => {
    const client = createLLMClientFromEnv({ GROQ_API_KEY: "gsk_test" });
    expect(client).toBeInstanceOf(OpenAICompatibleClient);
  });

  it("fails with an actionable message when the groq key is missing", () => {
    try {
      createLLMClientFromEnv({ LLM_PROVIDER: "groq" });
      expect.unreachable("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LLMError);
      expect((err as LLMError).message).toMatch(/GROQ_API_KEY/);
    }
  });

  it("keeps fake and openai-compatible providers working", () => {
    expect(createLLMClientFromEnv({ LLM_PROVIDER: "fake" })).toBeInstanceOf(FakeLLM);
    expect(
      createLLMClientFromEnv({ LLM_PROVIDER: "openai-compatible", OPENAI_API_KEY: "sk_test" })
    ).toBeInstanceOf(OpenAICompatibleClient);
    expect(() => createLLMClientFromEnv({})).toThrow(LLMError);
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON, fenced JSON and JSON with trailing commas", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose<{ a: number }[]>("```json\n[{\n\"a\":1}]\n```")).toEqual([{ a: 1 }]);
    expect(parseJsonLoose<{ a: number }>('{"a":1,}')).toEqual({ a: 1 });
  });

  it("extracts the first balanced object from surrounding prose", () => {
    const text = 'Sure! Here is the result: {"a": {"b": 2}} hope that helps';
    expect(parseJsonLoose<{ a: { b: number } }>(text)).toEqual({ a: { b: 2 } });
  });

  it("throws LLMError when nothing parseable exists", () => {
    expect(() => parseJsonLoose("no json here")).toThrow(LLMError);
  });
});
