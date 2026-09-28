import { scaDraftPreviewSignature, scaPreviewSignature, type ScaFormDraft } from './sca-launch.ts';

type PreviewReader = {
  getBranchHeadSha(branch: string): Promise<string>;
  getFile(path: string, ref: string): Promise<{ contentUtf8: string } | null>;
};

/** Pin the registry read to one commit; publishing must merge that same commit. */
export async function readScaPreviewContent(
  github: PreviewReader, path: string, branch: string, listingId: string,
): Promise<{ headSha: string; signature: string | null }> {
  const headSha = await github.getBranchHeadSha(branch);
  const file = await github.getFile(path, headSha);
  if (!file) throw new Error('Could not read the preview content. Refresh the preview PR and try again.');
  const registry = JSON.parse(file.contentUtf8);
  return { headSha, signature: scaPreviewSignature(listingId, registry?.listings?.[listingId]) };
}

export async function requireScaPreviewMatch(
  github: PreviewReader, path: string, branch: string | null, draft: ScaFormDraft | undefined,
  listingId: string | null,
): Promise<string> {
  const signature = draft && scaDraftPreviewSignature(draft);
  if (!branch || !draft || !signature || draft.guestyListingId.trim() !== listingId) {
    throw new Error('Refresh the preview PR with a complete draft before publishing.');
  }
  const preview = await readScaPreviewContent(github, path, branch, listingId);
  if (preview.signature !== signature) {
    throw new Error('Your form differs from the preview. Refresh the preview PR before publishing.');
  }
  return preview.headSha;
}
