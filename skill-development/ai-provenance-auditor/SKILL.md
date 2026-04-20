---
name: ai-provenance-auditor
description: Specialized workflows for implementing non-invasive AI training auditing and blockchain-based provenance systems. Use when developing or maintaining auditing SDKs (PyTorch/Python) and decentralized storage controllers (Node.js/OrbitDB/IPFS).
---

# AI Provenance Auditor

This skill codifies the workflows for building a zero-footprint auditing system for AI training processes, integrating cryptographic hashing with decentralized storage.

## Non-Invasive Auditing (PyTorch)

To maintain a "Zero-Footprint" philosophy, use global monkey-patching of PyTorch internal classes rather than requiring explicit logging calls in the training loop.

### Patching Strategy
- **Loss Capture**: Patch `torch.Tensor.backward` to automatically intercept loss scalar items.
- **Weights Capture**: Patch `torch.optim.Optimizer.__init__` to wrap the `step()` method of every instance. This ensures compatibility with all optimizer subclasses (SGD, Adam, etc.) without class-level conflicts.

### Implementation Pattern
```python
def _apply_global_patches(self):
    # 1. Patch Tensor.backward
    original_backward = torch.Tensor.backward
    def patched_backward(tensor_self, *args, **kwargs):
        if tensor_self.dim() == 0:
            self.current_loss = float(tensor_self.item())
        return original_backward(tensor_self, *args, **kwargs)
    torch.Tensor.backward = patched_backward

    # 2. Patch Optimizer instance step
    original_opt_init = torch.optim.Optimizer.__init__
    def patched_opt_init(opt_self, *args, **kwargs):
        original_opt_init(opt_self, *args, **kwargs)
        original_step = opt_self.step
        def hooked_step(*s_args, **s_kwargs):
            result = original_step(*s_args, **s_kwargs)
            self._on_step_completed(opt_self)
            return result
        object.__setattr__(opt_self, 'step', hooked_step)
    torch.optim.Optimizer.__init__ = patched_opt_init
```

## Audit Controller (Node.js + OrbitDB)

### Persistent Storage with Helia
Use `blockstore-level` for Helia persistence to ensure data survives process restarts.

```javascript
import { createHelia } from 'helia'
import { LevelBlockstore } from 'blockstore-level'
const blockstore = new LevelBlockstore('./ipfs/blocks')
const helia = await createHelia({ blockstore })
```

### Single-Node Dev Mode
In single-node environments (e.g., local testing), `gossipsub` may fail with `PublishError.NoPeersSubscribedToTopic`. Enable `allowPublishToZeroTopicPeers` to bypass this.

```javascript
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
const Libp2pOptions = {
  services: {
    pubsub: gossipsub({ allowPublishToZeroTopicPeers: true })
  }
}
```

## Cryptographic Standards
- **Datasets**: Use Merkle Roots for static file-system provenance.
- **Weights/Metrics**: Use SHA-256 for runtime state and metric packets.
- **Aggregation**: Combine all hashes into a signed "Audit Metadata Packet" for blockchain anchoring.

## Troubleshooting
- **Missing PubSub**: If OrbitDB fails with `addEventListener` errors, ensure `gossipsub` and `identify` services are enabled in the `libp2p` configuration.
- **Buffer Bloat**: Ensure the Python SDK uses an asynchronous background thread with a thread-safe queue to avoid impacting training latency.
