
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const runFile = promisify(execFile);

export async function checkCommand(
  command: string,
  args: string[]
) {
  try {
    const result = await runFile(command, args, {
      timeout: 5000
    });

    return {
      online: true,
      version: (result.stdout || result.stderr || 'Available')
        .split('\n')[0]
        .trim()
    };
  } catch {
    return {
      online: false,
      version: ''
    };
  }
}

export async function directoryExists(
  directory: string
): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

export async function directoryHasFiles(
  directory: string
): Promise<boolean> {
  try {
    return (await fs.readdir(directory)).length > 0;
  } catch {
    return false;
  }
}
