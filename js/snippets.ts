import type { StacAsset } from './types';

/** Code snippets the details view copies. JSON string literals are valid Python literals. */
export function pythonItemSnippet(selfHref: string): string {
  return `import jstex\n\nitem = jstex.item(${JSON.stringify(selfHref)})`;
}

/** True when the asset (or its `s3` alternate) is reachable over S3. */
export function hasS3(a: StacAsset): boolean {
  const s3 = (h?: string) =>
    !!h && (h.startsWith('s3://') || h.startsWith('/'));
  return s3(a.href) || s3(a.alternate?.s3?.href);
}

/** Python that downloads one asset over S3 with jstex's managed keys. */
export function pythonAssetSnippet(selfHref: string, assetKey: string): string {
  return [
    '# needs: pip install "jupyterlab-jstex[s3]"',
    'import jstex',
    '',
    `item = jstex.item(${JSON.stringify(selfHref)})`,
    `asset = item.assets[${JSON.stringify(assetKey)}]`,
    'loc = jstex.s3.location(asset)',
    'jstex.s3.client(asset).download_file(**loc, Filename=loc["Key"].rsplit("/", 1)[-1])'
  ].join('\n');
}
