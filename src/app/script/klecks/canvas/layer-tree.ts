import type { TKlLayer } from '../kl-types';

export type TLayerTreeNode = Pick<TKlLayer<unknown>, 'groupId' | 'parentGroupId' | 'isExpanded'>;

export function isGroupLayer<T extends TLayerTreeNode>(
    layer: T | undefined,
): layer is T & { groupId: string } {
    return typeof layer?.groupId === 'string' && layer.groupId.length > 0;
}

/** Direct children, in the same bottom-to-top order as layers. */
export function getGroupChildren<T extends TLayerTreeNode>(layers: T[], groupIndex: number): number[] {
    const group = layers[groupIndex];
    if (!isGroupLayer(group)) {
        return [];
    }
    return layers.flatMap((layer, index) =>
        index !== groupIndex && layer.parentGroupId === group.groupId ? [index] : [],
    );
}

export function getLayerDepth<T extends TLayerTreeNode>(layers: T[], index: number): number {
    const groups = new Map(
        layers.flatMap((layer, layerIndex) =>
            isGroupLayer(layer) ? [[layer.groupId, layerIndex] as const] : [],
        ),
    );
    let parentId = layers[index]?.parentGroupId;
    let depth = 0;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
        const parentIndex = groups.get(parentId);
        if (parentIndex === undefined) {
            break;
        }
        visited.add(parentId);
        depth++;
        parentId = layers[parentIndex].parentGroupId;
    }
    return depth;
}

/** Inclusive range for one postorder subtree. */
export function getSubtreeRange<T extends TLayerTreeNode>(
    layers: T[],
    index: number,
): { start: number; end: number } {
    const group = layers[index];
    if (!isGroupLayer(group)) {
        return { start: index, end: index };
    }
    const groups = new Map(
        layers.flatMap((layer) => (isGroupLayer(layer) ? [[layer.groupId, layer] as const] : [])),
    );
    let start = index;
    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex--) {
        let parentId = layers[candidateIndex].parentGroupId;
        const visited = new Set<string>();
        let belongsToGroup = false;
        while (parentId && !visited.has(parentId)) {
            if (parentId === group.groupId) {
                belongsToGroup = true;
                break;
            }
            visited.add(parentId);
            parentId = groups.get(parentId)?.parentGroupId;
        }
        if (!belongsToGroup) {
            break;
        }
        start = candidateIndex;
    }
    return { start, end: index };
}

/** Whether the row appears when collapsed ancestor groups are hidden. */
export function isLayerTreeVisible<T extends TLayerTreeNode>(layers: T[], index: number): boolean {
    const groups = new Map(
        layers.flatMap((layer) => (isGroupLayer(layer) ? [[layer.groupId, layer] as const] : [])),
    );
    let parentId = layers[index]?.parentGroupId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
        const parent = groups.get(parentId);
        if (!parent) {
            break;
        }
        if (parent.isExpanded === false) {
            return false;
        }
        visited.add(parentId);
        parentId = parent.parentGroupId;
    }
    return true;
}
