import { calculatePacketHash, verifyHashMatch } from './hashlib.js';

export const auditAllPackets = async (packets, chainAnchors) => {
    const results = new Map(); // key: step_id, value: status

    const getStepId = (p) => p.value.packet.type === 'step'
        ? p.value.packet.payload.id
        : p.value.packet.payload.step_id;

    packets.forEach(p => {
        results.set(getStepId(p), 'untrusted');
    });

    let sortedAnchorSteps = Object.keys(chainAnchors).map(Number).sort((a, b) => b - a);

    for (let anchorStep of sortedAnchorSteps) {
        let targetHash = chainAnchors[anchorStep];

        const pendingPackets = packets
            .filter(p => {
                const stepId = getStepId(p)
                return stepId <= anchorStep && results.get(stepId) === 'untrusted';
            })
            .sort((a, b) => {
                return getStepId(b) - getStepId(a);
            });

        for (const packet of pendingPackets) {
            const currentHash = calculatePacketHash(packet.value.packet);
            const stepId = getStepId(packet);

            if (verifyHashMatch(currentHash, targetHash)) {
                results.set(stepId, 'verified');
                targetHash = packet.value.packet.prev_hash;
            } else {
                results.set(stepId, 'invalid');
                break;
            }
        }
    }

    return Object.fromEntries(results);
}