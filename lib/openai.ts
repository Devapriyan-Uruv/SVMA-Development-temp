
import OpenAI from 'openai';
import { recordAiUsage } from '@/lib/aiUsage';

export const OPENAI_MODEL = process.env.URV_MODEL || 'uruv-light';

export const URUV_MODEL = process.env.URV_MODEL || 'uruv-light';

export const URUV_MODEL_EXTRACT =
  process.env.URV_MODEL_EXTRACT || 'uruv-heavy';

export const aiConfigured = (): boolean =>
  Boolean(
    process.env.URV_API_KEY &&
    (process.env.URV_BASE_URL || 'https://api.uruv.ai/v1')
  );

export const gatewayMode = aiConfigured;
/**
 * Responses-API-shaped facade over URUV Inai Chat Completions.
 * Existing call sites can continue using:
 * client.responses.create({...})
 * response.output_text
 */
export function getOpenAI(feature = 'general') {
  const apiKey = process.env.URV_API_KEY;
  const baseURL = process.env.URV_BASE_URL || 'https://api.uruv.ai/v1';

  if (!apiKey) {
    throw new Error('URV_API_KEY is missing');
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
      for (const m of body.input || []) {
        messages.push({
          role: m.role,
          content: toChatContent(m.content),
        });
      }
    }

    const fmt = body.text?.format;

    const res: any = await client.chat.completions.create(
      {
        model: body.model || OPENAI_MODEL,
        messages,

        ...(fmt?.type === 'json_object'
          ? {
              response_format: {
                type: 'json_object',
              },
            }
          : {}),

        ...(fmt?.type === 'json_schema'
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: fmt.name || 'result',
                  schema: fmt.schema,
                  strict: fmt.strict,
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
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      total_tokens: res.usage?.total_tokens ?? 0,
    };

    await recordAiUsage({
      feature,
      model: String(body.model || OPENAI_MODEL),
      usage,
      ms: Date.now() - started,
      costUsd: Number(res.uruv?.cost_usd ?? 0),
      requestId: res.uruv?.request_id,
    });

    return {
      output_text: res.choices?.[0]?.message?.content ?? '',
      model: res.model,
      usage,
      uruv: res.uruv,
    };
  };

  return {
    responses: { create },
  } as unknown as OpenAI;
}

/**
 * Responses API content parts -> Chat Completions content parts.
 */
function toChatContent(content: any) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((p: any) => {
    if (p.type === 'input_text') {
      return {
        type: 'text',
        text: p.text,
      };
    }

    if (p.type === 'input_image') {
      return {
        type: 'image_url',
        image_url: {
          url: p.image_url,
          detail: p.detail,
        },
      };
    }

    if (p.type === 'input_file') {
      if (!p.file_data) {
        throw new Error(
          'Send PDFs inline as file_data (base64); file_id is not supported'
        );
      }

      return {
        type: 'file',
        file: {
          filename: p.filename || 'document.pdf',
          file_data: p.file_data,
        },
      };
    }

    return p;
  });
}
