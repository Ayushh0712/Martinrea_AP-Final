import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { UPLOAD_SUBFOLDERS } from '../common/constants';

export type UploadSubfolder = (typeof UPLOAD_SUBFOLDERS)[keyof typeof UPLOAD_SUBFOLDERS];

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);
  private readonly uploadDir: string;

  constructor(private readonly config: ConfigService) {
    this.uploadDir = path.resolve(this.config.get<string>('upload.dir') ?? './uploads');
  }

  async onModuleInit(): Promise<void> {
    await this.ensureFolders();
  }

  getUploadRoot(): string {
    return this.uploadDir;
  }

  getSubfolderPath(sub: UploadSubfolder): string {
    return path.join(this.uploadDir, sub);
  }

  async ensureFolders(): Promise<void> {
    const folders = Object.values(UPLOAD_SUBFOLDERS).map((s) => this.getSubfolderPath(s));
    await Promise.all(folders.map((dir) => fs.mkdir(dir, { recursive: true })));
    this.logger.log(`Upload folders ready at ${this.uploadDir}`);
  }

  /**
   * Moves a file from its current path into the given subfolder.
   * Returns the new absolute path.
   */
  async moveTo(currentPath: string, sub: UploadSubfolder, newFilename?: string): Promise<string> {
    const targetDir = this.getSubfolderPath(sub);
    await fs.mkdir(targetDir, { recursive: true });

    const filename = newFilename ?? path.basename(currentPath);
    const targetPath = path.join(targetDir, filename);

    try {
      await fs.rename(currentPath, targetPath);
    } catch (err: unknown) {
      // Cross-device rename fallback
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(currentPath, targetPath);
        await fs.unlink(currentPath);
      } else {
        throw err;
      }
    }

    this.logger.log(`Moved file -> ${sub}: ${targetPath}`);
    return targetPath;
  }

  async deleteIfExists(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
