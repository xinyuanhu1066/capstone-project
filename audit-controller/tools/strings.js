export const deriveEntryId = (packet) => {
  if (packet.type === 'session') {
    return `${packet.session_id}-${packet.action}`
  } else if (packet.type === 'epoch' || packet.type === 'step') {
    return `${packet.session_id}-${packet.type}-${packet.payload.id}`
  } else {
    throw new Error('Invalid packet type')
  }
}