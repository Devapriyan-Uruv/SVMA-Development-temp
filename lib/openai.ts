
import OpenAI from 'openai';
import { recordAiUsage } from '@/lib/aiUsage';

export const OPENAI_MODEL = process.env.URV_MODEL || 'uruv-light';

/**
 * Responses-API-shaped facade over URUV Inai Chat Completions.
 * Existing call sites can continue using:
 * client.responses.create(...)
 * response.output_text
 */
export function getOpenAI(feature = 'general') {
  const apiKey = process.env.URV_API_KEY;
  const baseURL = process.env.URV_BASE_URL;

  if (!apiKey || !baseURL) {
    throw new Error('URV_API_KEY / URV_BASE_URL missing');
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: 120_000,
    maxRetries: 2,
  });

  const create = async (body: any, opts?: any) => {
    const started = Date.now();
    const messages: any[] = [];

    if (body.instructions) {
      messages.push({
        role: 'system',
        content: body.instructions,
      });
    }

    if (typeof body.input === 'string') {
      messages.push({
        role: 'user',
        content: body.input,
      });
    } else {
      for (const message of body.input || []) {
        messages.push({
          role: message.role,
          content: toChatContent(message.content),
        });
      }
    }

    const format = body.text?.format;

    const response: any = await client.chat.completions.create(
      {
        model: body.model || OPENAI_MODEL,
        messages,
        ...(format?.type === 'json_object'
          ? { response_format: { type: 'json_object' } }
          : {}),
        ...(format?.type === 'json_schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: format.name || 'result',
                  schema: format.schema,
                  strict: format.strict,
                },
              },
            }
          : {}),
        ...(body.max_output_tokens
          ? { max_tokens: body.max_output_tokens }
          : {}),
        ...(body.reasoning?.effort
          ? { reasoning_effort: body.reasoning.effort }
          : {}),
        metadata: {
          data_classification: 'confidential',
        },
      } as any,
      opts
    );

    const usage = {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: response.usage?.total_tokens ?? 0,
    };

    await recordAiUsage({
      feature,
      model: String(body.model || OPENAI_MODEL),
      usage,
      ms: Date.now() - started,
      costUsd: Number(response.uruv?.cost_usd ?? 0),
      requestId: response.uruv?.request_id ?? null,
    });

    return {
      output_text: response.choices?.[0]?.message?.content ?? '',
      model: response.model,
      usage,
      uruv: response.uruv,
    };
  };

  return {
    responses: { create },
  } as unknown as OpenAI;
}

/** Convert Responses API content parts into Chat Completions content parts. */
function toChatContent(content: any) {
  if (typeof content === 'string') return content;

  return (content || []).map((part: any) => {
    if (part.type === 'input_text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    if (part.type === 'input_image') {
      return {
        type: 'image_url',
        image_url: {
          url: part.image_url,
          detail: part.detail,
        },
      };
    }

    if (part.type === 'input_file') {
      if (!part.file_data) {
        throw new Error(
          'Send PDFs inline as file_data (base64); file_id is not supported'
        );
      }

      return {
        type: 'file',
        file: {
          filename: part.filename || 'document.pdf',
          file_data: part.file_data,
        },
      };
    }

    return part;
  });
}
