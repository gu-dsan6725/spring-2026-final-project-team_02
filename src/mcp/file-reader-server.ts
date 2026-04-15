/**
 * File reader tool server.
 *
 * Extracts text from user-uploaded files.
 * Supports: PDF (via pdf-parse), DOCX (via mammoth), TXT/MD (native fs).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

interface FileReaderResult {
  file_path: string;
  content: string;
  char_count: number;
}

export async function fileReaderHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const filePath = typeof input.file_path === 'string' ? input.file_path : '';

  if (filePath.length === 0) {
    return { error: 'file_path is required' };
  }

  const ext = path.extname(filePath).toLowerCase();

  let content = '';

  try {
    switch (ext) {
      case '.pdf': {
        // Dynamic import to avoid bundling pdf-parse in client code
        const pdfModule = await import('pdf-parse');
        // pdf-parse exports differently depending on module format
        const pdfParse =
          'default' in pdfModule
            ? (pdfModule as unknown as { default: (buf: Buffer) => Promise<{ text: string }> })
                .default
            : (pdfModule as unknown as (buf: Buffer) => Promise<{ text: string }>);
        const buffer = await fs.readFile(filePath);
        const parsed = await pdfParse(buffer);
        content = parsed.text;
        break;
      }

      case '.docx': {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        content = result.value;
        break;
      }

      case '.txt':
      case '.md': {
        content = await fs.readFile(filePath, 'utf-8');
        break;
      }

      default:
        return { error: `Unsupported file type: ${ext}` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ENOENT')) {
      return { error: `File not found: ${filePath}` };
    }
    return { error: `Failed to read file: ${message}` };
  }

  const result: FileReaderResult = {
    file_path: filePath,
    content,
    char_count: content.length,
  };

  return result as unknown as Record<string, unknown>;
}
