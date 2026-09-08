import type { UploadPort } from "../ports";

export interface FileUploader {
  integrations: { Core: { UploadFile(input: { file: File }): Promise<{ file_url: string }> } };
}

export class Base44UploadService implements UploadPort {
  constructor(private readonly client: FileUploader) {}

  async upload(file: File): Promise<{ url: string }> {
    const { file_url } = await this.client.integrations.Core.UploadFile({ file });
    return { url: file_url };
  }
}
