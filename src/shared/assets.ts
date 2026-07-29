export type AssetSource = "ai" | "attachment" | "import";

export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
  source: AssetSource;
  tags: string[];
  favorite: boolean;
  trashed: boolean;
}

export interface AssetReference {
  assetId: string;
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
}

export const assetHref = (id: string) => `mailuo-asset:${id}`;

