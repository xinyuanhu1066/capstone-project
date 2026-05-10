import os
import torch
import threading
import queue
import fnmatch
import functools
import sys
import requests
import uuid
import time
import io
import zstandard as zstd
from typing import Any, Dict, Optional, List, Tuple
from audit_sdk.hashing_engine.engine import HashingEngine
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource, SERVICE_NAME
from opentelemetry import trace as otel_trace
import logging
import json


# Configuration
CONTROLLER_URL = os.getenv("AUDIT_CONTROLLER_URL", "http://localhost:3000")
PACKET_API_URL = f"{CONTROLLER_URL}/audit/packet"
BLOB_API_URL = f"{CONTROLLER_URL}/audit/blob"


class JsonFormatter(logging.Formatter):
    _SKIP_FIELDS = frozenset((
        'msg', 'args', 'levelname', 'levelno', 'pathname', 'filename',
        'module', 'exc_info', 'exc_text', 'stack_info', 'lineno',
        'funcName', 'created', 'msecs', 'relativeCreated', 'thread',
        'threadName', 'processName', 'process', 'name', 'message'
    ))

    def format(self, record):
        log_data = {
            'level': record.levelname.lower(),
            'event': record.getMessage(),
            'logger': record.name,
            'time': self.formatTime(record)
        }
        if record.exc_info:
            log_data['exc_info'] = self.formatException(record.exc_info)
        for key, val in record.__dict__.items():
            if key not in self._SKIP_FIELDS:
                log_data[key] = val
        
        span = otel_trace.get_current_span()
        if span and span.is_recording():
            ctx = span.get_span_context()
            log_data['traceId'] = format(ctx.trace_id, '032x')
            log_data['spanId'] = format(ctx.span_id, '016x')
        return json.dumps(log_data)


class TrainingWatcher:
    """
    Completely Non-Invasive Watcher: Uses global monkey-patching to capture training data.
    """
    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(TrainingWatcher, cls).__new__(cls)
        return cls._instance

    def __init__(
            self, dataset_dir: Optional[str] = None,
            step_interval: int = 100, dataset_name: str = "Unknown",
            exclude: list = [],
            log_path: str = "watcher.log"):
        if hasattr(self, '_initialized') and self._initialized:
            return
        
        self._setup_logging(log_path)
        
        provider = TracerProvider(
            resource=Resource.create({
                SERVICE_NAME: "watcher"
            })
        )
        provider.add_span_processor(
            BatchSpanProcessor(OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces"))
        )
        trace.set_tracer_provider(provider)
        self.tracer = trace.get_tracer("watcher")


        metric_reader = PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint="http://localhost:4318/v1/metrics"),
            export_interval_millis=5000
        )
        meter_provider = MeterProvider(
            resource=Resource.create({
                SERVICE_NAME: "watcher"
            }),
            metric_readers=[metric_reader]
        )
        metrics.set_meter_provider(meter_provider)
        meter = metrics.get_meter("watcher")

        self.loss_gauge = meter.create_gauge("training.loss")
        self.step_counter = meter.create_counter("training.steps")
        self.queue_size_gauge = meter.create_gauge("watcher.packet_queue_size")
        self.blob_upload_histogram = meter.create_histogram(
            "watcher.blob_upload_duration_ms",
            description="IPFS blob upload latency"
        )
        self.dispatch_histogram = meter.create_histogram(
            "watcher.dispatch_duration_ms", 
            description="Packet dispatch to controller latency"
        )
        
        self.dataset_dir = dataset_dir or os.path.join(os.getcwd(), 'data')
        self.dataset_name = dataset_name
        self.step_interval = step_interval
        self.hashing_engine = HashingEngine()
        self.buffer = queue.Queue()
        self.is_running = True
        self.global_step = 0
        self.current_loss = 0.0
        self.current_epoch = 0
        self.hyperparams = {}
        self.exclude = set(exclude + ["dummy.txt"])
        
        # Risk Mitigation: Step-level metrics tracking for anomaly detection
        self.step_metrics: List[float] = []

        # Generate a unique session ID for this training run
        self.session_id = f"session-{int(time.time())}-{str(uuid.uuid4())[:8]}"
        
        # Dataset Strategy (Plan Section 2.A): Map CID to OrbitDB
        self.dataset_merkle_root = self._calculate_initial_merkle_root()
        self.dataset_cid = self._snapshot_dataset()
        
        # Identifier Refactor: Resolve semantic version
        self.dataset_version = self._resolve_dataset_version()
        
        self._loader_sizes: Dict[int, int] = {}
        self._train_loader_id: Optional[int] = None
        self._last_optimizer: Optional[Any] = None
        
        self._initialized = True

        # Start background processing threads
        self.processor_thread = threading.Thread(target=self._process_buffer, daemon=True)
        self.processor_thread.start()
        
        self._apply_global_patches()
        self.logger.info("watcher.session_started", extra={
            "session_id": self.session_id,
            "dataset_name": self.dataset_name,
            "dataset_version": self.dataset_version
        })

    def _setup_logging(self, log_path: str):
        os.makedirs(os.path.dirname(log_path), exist_ok=True)

        handler = logging.FileHandler(log_path)
        handler.setFormatter(JsonFormatter())

        watcher_logger = logging.getLogger('audit_sdk.watcher')
        watcher_logger.addHandler(handler)
        watcher_logger.setLevel(logging.INFO)
        watcher_logger.propagate = False
        
        self.logger = watcher_logger

    def _resolve_dataset_version(self) -> str:
        """Resolve semantic version from OrbitDB via Audit Controller (Identifier Refactor 1.B)."""
        try:
            payload = {
                "dataset_name": self.dataset_name,
                "merkle_root": self.dataset_merkle_root
            }
            response = requests.post(f"{CONTROLLER_URL}/audit/dataset/version", json=payload, timeout=5)
            if response.status_code == 200:
                return response.json().get("version", "v1.0")
        except Exception as e:
            self.logger.error("watcher.dataset_version_resolve_failed", extra={
                "session_id": self.session_id,
                "error": str(e),
                "dataset_name": self.dataset_name,
                "merkle_root": self.dataset_merkle_root,
            })
        return "v1.0"

    def _should_exclude(self, filename: str) -> bool:
        for pattern in self.exclude:
            if fnmatch.fnmatch(filename, pattern):
                return True
        return False

    def _snapshot_dataset(self) -> str:
        """Upload dataset to IPFS to get a Root CID (Plan Section 2.A)."""
        with self.tracer.start_as_current_span("watcher.snapshot_dataset") as span:
            span.set_attributes({
                "dataset.name": self.dataset_name,
                "dataset.dir": self.dataset_dir
            })
            if not os.path.exists(self.dataset_dir):
                return "no-dataset-found"
            
            print(f"[Watcher] Taking IPFS snapshot of dataset: {self.dataset_dir}...")
            sys.stdout.flush()
            
            files_to_upload = []
            for root, _, files in os.walk(self.dataset_dir):
                for file in files:
                    if self._should_exclude(file):
                        continue
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.dataset_dir)
                    with open(full_path, 'rb') as f:
                        content = f.read()
                        file_cid = self._upload_blob(content)
                        if file_cid:
                            files_to_upload.append({
                                "path": rel_path,
                                "cid": file_cid
                            })
            try:
                payload = {
                    "dataset_name": self.dataset_name,
                    "files": files_to_upload
                }
                response = requests.post(f"{CONTROLLER_URL}/audit/dataset/directory", json=payload, timeout=30)
                if response.status_code == 201:
                    root_cid = response.json().get("root_cid", "snapshot-failed")
                    span.set_attribute("dataset.file_count", len(files_to_upload))
                    span.set_attribute("dataset.root_cid", root_cid)
                    return root_cid
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR)
                self.logger.error("watcher.snapshot_dataset_failed", extra={
                    "session_id": self.session_id,
                    "dataset_name": self.dataset_name
                })
                
            return "snapshot-failed"

    def _calculate_initial_merkle_root(self) -> str:
        with self.tracer.start_as_current_span("watcher.calculate_merkle_root") as span:
            if not os.path.exists(self.dataset_dir):
                return ""
            file_paths = []
            for root, _, files in os.walk(self.dataset_dir):
                for file in files:
                    if self._should_exclude(file):
                        continue
                    file_paths.append(os.path.join(root, file))
            result = self.hashing_engine.calculate_merkle_root(file_paths, base_dir=self.dataset_dir)
            span.set_attributes({
                "dataset.file_count": len(file_paths),
                "dataset.merkle_root": result[:16]
            })
            return result

    def _apply_global_patches(self):
        # 1. Patch Tensor.backward to capture loss values automatically
        original_backward = torch.Tensor.backward
        watcher_self = self

        @functools.wraps(original_backward)
        def patched_backward(tensor_self, *args, **kwargs):
            if tensor_self.dim() == 0:
                watcher_self.current_loss = float(tensor_self.item())
            return original_backward(tensor_self, *args, **kwargs)

        torch.Tensor.backward = patched_backward

        # 2. Patch Optimizer.step logic
        original_opt_init = torch.optim.Optimizer.__init__

        @functools.wraps(original_opt_init)
        def patched_opt_init(opt_self, *args, **kwargs):
            original_opt_init(opt_self, *args, **kwargs)
            original_step = opt_self.step
            
            @functools.wraps(original_step)
            def hooked_step(*s_args, **s_kwargs):
                watcher_self._last_optimizer = opt_self
                result = original_step(*s_args, **s_kwargs)
                
                watcher_self.global_step += 1
                # Accumulate metrics for anomaly detection
                watcher_self.step_metrics.append(watcher_self.current_loss)
                
                if watcher_self.global_step % watcher_self.step_interval == 0:
                    watcher_self._capture_snapshot(opt_self)
                
                return result
            
            object.__setattr__(opt_self, 'step', hooked_step)

        torch.optim.Optimizer.__init__ = patched_opt_init

        # 3. Patch DataLoader.__iter__
        original_iter = torch.utils.data.DataLoader.__iter__
        watcher = self

        @functools.wraps(original_iter)
        def patched_iter(loader_self):
            loader_id = id(loader_self)
            try:
                dataset_len = len(loader_self.dataset)
            except (AttributeError, TypeError):
                dataset_len = 0

            watcher._loader_sizes[loader_id] = dataset_len
            if watcher._train_loader_id is None or \
               dataset_len > watcher._loader_sizes.get(watcher._train_loader_id, 0):
                watcher._train_loader_id = loader_id

            inner_iter = original_iter(loader_self)
            return _SentinelIter(inner_iter, loader_id, watcher)

        torch.utils.data.DataLoader.__iter__ = patched_iter
        sys.stdout.flush()

    def _on_dataloader_exhausted(self, loader_id: int):
        with self.tracer.start_as_current_span("watcher.epoch_checkpoint") as span:
            span.set_attributes({
                "epoch.id": self.current_epoch + 1,
                "session.id": self.session_id
            })
            if loader_id != self._train_loader_id:
                return

            self.current_epoch += 1
            epoch = self.current_epoch

            # Perform Full Checkpoint Persistence (As per plan Section 2.C)
            checkpoint_data = self._capture_full_checkpoint()
            checkpoint_hash = self.hashing_engine.calculate_sha256(checkpoint_data)

            self.buffer.put({
                "type": "epoch",
                "epoch_id": epoch,
                "step_id": self.global_step,
                "checkpoint_hash": checkpoint_hash,
                "checkpoint": checkpoint_data
            })
            span.set_attribute("checkpoint.size_bytes", len(checkpoint_data))
            self.logger.info("watcher.epoch_boundary_reached", extra={
                "session_id": self.session_id,
                "step": self.global_step,
                "epoch": epoch
            })

    def _capture_full_checkpoint(self) -> Optional[bytes]:
        """Save full model weights to a binary buffer and compress with Zstd."""
        if self._last_optimizer is None:
            return None
        
        with self.tracer.start_as_current_span("watcher.capture_full_checkpoint") as span:
            span.set_attributes({
                "session.id": self.session_id,
                "epoch.id": self.current_epoch,
                "training.step": self.global_step
            })

            with self.tracer.start_as_current_span("watcher.checkpoint_serialize") as serialize_span:
                try:
                    current_lrs = [
                        pg['lr'] for pg in self._last_optimizer.param_groups
                    ]
                    serialize_span.set_attributes({
                        "optimizer.type": type(self._last_optimizer).__name__,
                        "optimizer.current_lr": str(current_lrs),
                    })
                    state = {
                        'step': self.global_step,
                        'optimizer': {
                            'param_groups': [
                                {k: v for k, v in pg.items() if k != 'params'}
                                for pg in self._last_optimizer.param_groups
                            ],
                            'state': self._last_optimizer.state
                        }
                    }
                    buffer = io.BytesIO()
                    torch.save(state, buffer)
                    raw_data = buffer.getvalue()
                    serialize_span.set_attribute("checkpoint.raw_size_bytes", len(raw_data))
                except Exception as e:
                    serialize_span.record_exception(e)
                    serialize_span.set_status(trace.StatusCode.ERROR)
                    self.logger.error("watcher.checkpoint_serialize_failed", extra={
                        "session_id": self.session_id,
                        "error": str(e)
                    })
                    return None
            with self.tracer.start_as_current_span("watcher.checkpoint_compress") as compress_span:
                try:
                    cctx = zstd.ZstdCompressor(level=3)
                    compressed_data = cctx.compress(raw_data)
                    compress_span.set_attributes({
                        "checkpoint.raw_size_bytes": len(raw_data),
                        "checkpoint.compressed_size_bytes": len(compressed_data),
                        "checkpoint.compression_ratio": round(len(raw_data) / len(compressed_data), 2)
                    })
                    return compressed_data
                except Exception as e:
                    compress_span.record_exception(e)
                    compress_span.set_status(trace.StatusCode.ERROR)
                    self.logger.error("watcher.checkpoint_compress_failed", extra={
                        "session_id": self.session_id,
                        "error": str(e)
                    })
                    return None

    def _capture_snapshot(self, optimizer):
        """Standard step snapshot: Binary hash + metrics."""        
        # Multi-step metrics for anomaly detection (Plan 3.B)

        with self.tracer.start_as_current_span("watcher.capture_snapshot") as span:
            attrs = {"session_id": self.session_id}
            span.set_attributes({
                "training.step": self.global_step,
                "training.loss": self.current_loss,
                "session.id": self.session_id
            })
            self.loss_gauge.set(self.current_loss, attrs)
            self.step_counter.add(1, attrs)
            self.queue_size_gauge.set(self.buffer.qsize(), attrs)

            metrics_data = {
                "loss": self.current_loss,
                "step_metrics": self.step_metrics.copy()
            }
            self.step_metrics = [] # Reset for next interval

            self.buffer.put({
                "type": "step",
                "step_id": self.global_step,
                "metrics": metrics_data,
            })

    def configure(self, hyperparams: Dict[str, Any]):
        self.hyperparams.update(hyperparams)

    def _process_buffer(self):
        while self.is_running:
            try:
                data = self.buffer.get(timeout=1.0)

                # Obtain latest packet hash from controller to link chain (may be empty)
                prev_hash = self._get_latest_packet_hash(self.session_id)

                if data["type"] == "session":
                    level = "Session"
                    if data["action"] == "start":
                        payload = {
                            "dataset_name": self.dataset_name,
                            "dataset_version": self.dataset_version,
                            "dataset_merkle_root": self.dataset_merkle_root,
                            "dataset_cid": self.dataset_cid,
                            "hyperparams": self.hyperparams,
                        }
                    elif data["action"] == "end":
                        payload = {
                            "model_cid": data["model_cid"],
                            "model_hash": data["model_hash"],
                        }
                    else:
                        self.buffer.task_done()
                        continue
                elif data["type"] == "epoch":
                    level = f"Epoch {data['epoch_id']}"
                    cid = None
                    if data["checkpoint"]:
                        cid = self._upload_blob(data["checkpoint"])
                    payload = {
                        "id": data["epoch_id"],
                        "step_id": data["step_id"],
                        "checkpoint_hash": data["checkpoint_hash"],
                        "checkpoint_cid": cid,
                    }
                elif data["type"] == "step":
                    level = "Step"
                    payload = {
                        "id": data["step_id"],
                        "metrics": data["metrics"]
                    }
                else:
                    self.buffer.task_done()
                    continue
                
                packet, packet_hash = self._create_audit_packet(
                    session_id=self.session_id,
                    packet_type=data["type"],
                    payload=payload,
                    prev_hash=prev_hash,
                    action=data.get("action", "")
                )

                self._dispatch(
                    {"packet": packet, "packet_hash": packet_hash},
                    PACKET_API_URL,
                    level=level
                )
                self.buffer.task_done()
            except queue.Empty:
                continue

    def _upload_blob(self, blob: bytes) -> Optional[str]:
        """Upload binary data to the Audit Controller and return the CID."""
        with self.tracer.start_as_current_span("watcher.upload_blob") as span:
            span.set_attribute("blob.size_bytes", len(blob))
            start = time.time()
            try:
                response = requests.post(
                    BLOB_API_URL, 
                    data=blob, 
                    headers={'Content-Type': 'application/octet-stream'},
                    timeout=60
                )
                elapsed = (time.time() - start) * 1000
                self.blob_upload_histogram.record(elapsed, {"session_id": self.session_id})
                if response.status_code == 201:
                    cid = response.json().get("cid")
                    span.set_attribute("blob.cid", cid)
                    return cid
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR)
                self.logger.error("watcher.blob_upload_failed", extra={
                    "session_id": self.session_id,
                    "blob_size": len(blob)
                })

            return None

    def _get_latest_packet_hash(self, session_id: str) -> str:
        """Query Audit Controller for the on-chain/latest packet hash for a session."""
        try:
            resp = requests.get(f"{CONTROLLER_URL}/audit/sessions/{session_id}", timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                # Support multiple key name formats returned by controller
                for k in ["latestPacketHash", "latest_packet_hash", "latestPacketHash", "latest_packetHash"]:
                    if isinstance(data.get(k), str) and data.get(k):
                        return data.get(k)
        except Exception:
            pass
        return ""

    def _dispatch(self, payload: Dict[str, Any], url: str, level: str = ""):
        with self.tracer.start_as_current_span("watcher.dispatch") as span:
            span.set_attributes({
                "packet.type": payload["packet"]["type"],
                "packet.hash": payload["packet_hash"][:16],
                "session.id": self.session_id
            })
            start = time.time()
            try:
                response = requests.post(url, json=payload, timeout=5)
                elapsed = (time.time() - start) * 1000
                self.dispatch_histogram.record(elapsed, {"packet_type": payload["packet"]["type"]})
                if response.status_code == 201:
                    res_data = response.json()
                    print(
                        f"[Audit Log] {level} {payload['packet']['payload'].get('step_id','')} | "
                        f"Hash: {payload['packet_hash'][:10]}... | Transation: {res_data.get('tx_hash', 'N/A')[:10]}..."
                    )
                sys.stdout.flush()
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR)
                self.logger.error("watcher.packet_upload_failed", extra={
                    "session_id": self.session_id,
                    "packet_type": payload["packet"]["type"],
                    "packet_hash": payload["packet_hash"][:16],
                })


    def _create_audit_packet(
            self, session_id: str, packet_type: str,
            payload: Dict[str, Any], prev_hash: str,
            action: str="") -> Tuple[Dict[str, Any], str]:
        packet = {
            "session_id": session_id,
            "type": packet_type,
            "payload": payload,
            "prev_hash": prev_hash,
            "action": action
        }
        packet_hash = self.hashing_engine.calculate_sha256(packet)
        return packet, packet_hash
    
    def stop(self, final_model_path: Optional[str] = None):
        """Risk Mitigation: Mandatory final capture (Plan 3.A)"""
        self.logger.info("watcher.session_ended", extra={
            "session_id": self.session_id,
        })

        with self.tracer.start_as_current_span("watcher.stop") as span:
            span.set_attribute("session.id", self.session_id)
            if self.global_step % self.step_interval != 0 and self._last_optimizer:
                self._capture_snapshot(self._last_optimizer)
            
            if final_model_path and os.path.exists(final_model_path):
                model_size = os.path.getsize(final_model_path)
                span.set_attribute("model.path", final_model_path)
                span.set_attribute("model.size_bytes", model_size)

                with self.tracer.start_as_current_span("watcher.upload_final_model") as upload_span:
                    with open(final_model_path, 'rb') as f:
                        model_bytes = f.read()
                    
                    print(f"[Watcher] Uploading final model {final_model_path} to IPFS...")
                    sys.stdout.flush()

                    model_cid = self._upload_blob(model_bytes)
                    model_hash = self.hashing_engine.calculate_sha256(model_bytes)
                    upload_span.set_attributes({
                        "model.cid": model_cid or "failed",
                        "model.hash": model_hash[:16]
                    })

                self.buffer.put({
                    "type": "session",
                    "action": "end",
                    "model_cid": model_cid,
                    "model_hash": model_hash
                })

            with self.tracer.start_as_current_span("watcher.flush_buffer") as flush_span:
                flush_start = time.time()
                try:
                    self.buffer.join()
                except Exception:
                    pass
                flush_span.set_attribute("flush.duration_ms", (time.time() - flush_start) * 1000)
            
            self.is_running = False
            if self.processor_thread.is_alive():
                self.processor_thread.join(timeout=2.0)


class _SentinelIter:
    __slots__ = ('_inner', '_loader_id', '_watcher', '_exhausted')
    def __init__(self, inner, loader_id: int, watcher: TrainingWatcher):
        self._inner = inner
        self._loader_id = loader_id
        self._watcher = watcher
        self._exhausted = False
    def __iter__(self): return self
    def __next__(self):
        try:
            return next(self._inner)
        except StopIteration:
            if not self._exhausted:
                self._exhausted = True
                threading.Thread(target=self._watcher._on_dataloader_exhausted, args=(self._loader_id,), daemon=True).start()
            raise
    def __len__(self):
        try: return len(self._inner)
        except: return 0

def init(
        dataset_dir: Optional[str] = None,
        step_interval: int = 100,
        hyperparams: Optional[Dict[str, Any]] = None,
        dataset_name: str = "Unknown",
        exclude: list = [],
        log_path: str = "watcher.log"
    ):
    watcher = TrainingWatcher(
        dataset_dir=dataset_dir,
        step_interval=step_interval,
        dataset_name=dataset_name,
        exclude=exclude,
        log_path=log_path
    )
    if hyperparams:
        watcher.configure(hyperparams)
    with watcher.tracer.start_as_current_span("watcher.session_start") as span:
        span.set_attributes({
            "session.id": watcher.session_id,
            "dataset.name": watcher.dataset_name,
            "dataset.version": watcher.dataset_version,
            "hyperparams.lr": str(hyperparams.get("lr", "")),
            "hyperparams.batch_size": str(hyperparams.get("batch_size", ""))
        })
        watcher.buffer.put({"type": "session", "action": "start"})
    return watcher
