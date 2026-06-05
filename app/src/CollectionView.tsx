export function CollectionView({ collectionId, projectId }: { collectionId: string; projectId: string }) {
  return <div className="p-6 text-ink-muted">Collection {collectionId} ({projectId})</div>
}
