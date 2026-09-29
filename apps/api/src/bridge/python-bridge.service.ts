import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { loadConfig } from '../config/app.config.js';

/** Runs the Python ML engine (`python -m vermax.cli <cmd> <json>`) and parses the JSON on its last stdout line. */
@Injectable()
export class PythonBridgeService {
  private readonly log = new Logger(PythonBridgeService.name);
  private readonly cfg = loadConfig();
  private running = false;

  get busy() {
    return this.running;
  }

  run<T = unknown>(command: string, args: Record<string, unknown> = {}, timeoutMs = 20 * 60_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t0 = Date.now();
      const child = spawn(this.cfg.pythonBin, ['-u', '-m', 'vermax.cli', command, JSON.stringify(args)], {
        cwd: this.cfg.mlDir,
        env: { ...process.env, VERMAX_DB: this.cfg.sqlitePath, PYTHONIOENCODING: 'utf-8' },
        windowsHide: true,
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`python ${command} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      child.stdout.on('data', (d) => (out += d.toString()));
      child.stderr.on('data', (d) => (err += d.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`python ${command} exited ${code}: ${err.trim().split('\n').slice(-6).join(' | ')}`));
        const line = out.trim().split('\n').filter(Boolean).pop() ?? '';
        try {
          this.log.log(`python ${command} finished in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
          resolve(JSON.parse(line) as T);
        } catch {
          reject(new Error(`python ${command}: could not parse output: ${line.slice(0, 200)}`));
        }
      });
    });
  }
}
