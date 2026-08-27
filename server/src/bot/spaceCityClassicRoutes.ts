import type { Vec2 } from "../../../shared/utils/v2.ts";

interface RouteNode {
    id: string;
    pos: Vec2;
}

const nodes: RouteNode[] = [
    { id: "spawn_nw", pos: { x: 100, y: 100 } },
    { id: "spawn_ne", pos: { x: 700, y: 100 } },
    { id: "spawn_sw", pos: { x: 100, y: 700 } },
    { id: "spawn_se", pos: { x: 700, y: 700 } },
    { id: "assembly", pos: { x: 220, y: 220 } },
    { id: "control", pos: { x: 620, y: 200 } },
    { id: "fuel", pos: { x: 180, y: 610 } },
    { id: "storage", pos: { x: 600, y: 615 } },
    { id: "launch_pad", pos: { x: 400, y: 400 } },
    { id: "north_corridor", pos: { x: 400, y: 110 } },
    { id: "south_corridor", pos: { x: 400, y: 730 } },
    { id: "east_corridor", pos: { x: 730, y: 400 } },
    { id: "west_corridor", pos: { x: 70, y: 400 } },
];

const edges: Array<[string, string]> = [
    ["spawn_nw", "assembly"], ["assembly", "launch_pad"],
    ["spawn_ne", "control"], ["control", "launch_pad"],
    ["spawn_sw", "fuel"], ["fuel", "launch_pad"],
    ["spawn_se", "storage"], ["storage", "launch_pad"],
    ["spawn_nw", "north_corridor"], ["north_corridor", "spawn_ne"],
    ["spawn_sw", "south_corridor"], ["south_corridor", "spawn_se"],
    ["spawn_nw", "west_corridor"], ["west_corridor", "spawn_sw"],
    ["spawn_ne", "east_corridor"], ["east_corridor", "spawn_se"],
];

function findNode(id: string): RouteNode | undefined {
    return nodes.find((n) => n.id === id);
}

function neighbors(id: string): RouteNode[] {
    return edges
        .filter(([a, b]) => a === id || b === id)
        .map(([, other]) => other === id ? edges.find(([x]) => x === id)?.[1] : edges.find(([, y]) => y === id)?.[0])
        .map((nid) => nid ? findNode(nid) : undefined)
        .filter((n): n is RouteNode => n !== undefined);
}

export function planRoute(from: string, to: string): RouteNode[] {
    if (from === to) return [findNode(to)].filter(Boolean) as RouteNode[];
    const visited = new Set<string>();
    const queue: Array<{ node: RouteNode; path: RouteNode[] }> = [{ node: findNode(from)!, path: [findNode(from)!] }];
    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.node.id === to) return current.path;
        visited.add(current.node.id);
        for (const next of neighbors(current.node.id)) {
            if (!visited.has(next.id)) {
                queue.push({ node: next, path: [...current.path, next] });
            }
        }
    }
    return [];
}

export function validateRoutes(): boolean {
    return edges.every(([a, b]) => findNode(a) !== undefined && findNode(b) !== undefined);
}
