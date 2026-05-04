import { calculatePacketHash, verifyHashMatch } from './hashlib.js';

export const auditAllPackets = async (packets, chainAnchors) => {
    const results = new Map(); // key: step_id, value: status

    packets.forEach(p => {
        const stepId = p.value.type === 'step' ? p.value.payload.id : p.value.payload.step_id;
        results.set(stepId, 'untrusted');
    });

    let sortedAnchorSteps = Object.keys(chainAnchors).sort((a, b) => b - a);

    for (let anchorStep of sortedAnchorSteps) {
        let targetHash = chainAnchors[anchorStep];

        const pendingPackets = packets
            .filter(p => {
                const stepId = p.value.type === 'step' ? p.value.payload.id : p.value.payload.step_id;
                return stepId <= anchorStep && results.get(stepId) === 'untrusted';
            })
            .sort((a, b) => {
                const stepIdA = a.value.type === 'step' ? a.value.payload.id : a.value.payload.step_id;
                const stepIdB = b.value.type === 'step' ? b.value.payload.id : b.value.payload.step_id;
                return stepIdB - stepIdA;
            });

        for (const packet of pendingPackets) {
            const currentHash = calculatePacketHash(packet);

            if (verifyHashMatch(currentHash, targetHash)) {
                const stepId = packet.value.type === 'step' ? packet.value.payload.id : packet.value.payload.step_id;
                results.set(stepId, 'verified');
                targetHash = packet.value.prev_hash;
            } else {
                const stepId = packet.value.type === 'step' ? packet.value.payload.id : packet.value.payload.step_id;
                results.set(stepId, 'invalid');
                break;
            }
        }
    }

    return results;
}