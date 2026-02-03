#!/usr/bin/env python3
"""
Job Manager

Tracks job status, progress, and metadata for simulation runs.
"""

import json
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any


class JobManager:
    """Manages job status and progress tracking."""
    
    STATUSES = ['queued', 'running', 'success', 'failed', 'stopped']
    
    def __init__(self, metadata_dir: Path):
        self.metadata_dir = metadata_dir
        self.jobs: Dict[str, Dict] = {}
        self._load_jobs()
    
    def _load_jobs(self):
        """Load job metadata from disk."""
        jobs_file = self.metadata_dir / "jobs.json"
        if jobs_file.exists():
            try:
                with open(jobs_file, 'r') as f:
                    self.jobs = json.load(f)
            except:
                self.jobs = {}
    
    def _save_jobs(self):
        """Save job metadata to disk."""
        jobs_file = self.metadata_dir / "jobs.json"
        with open(jobs_file, 'w') as f:
            json.dump(self.jobs, f, indent=2, default=str)
    
    def create_job(self, job_id: str, run_id: str) -> Dict:
        """Create a new job entry."""
        job = {
            "job_id": job_id,
            "run_id": run_id,
            "status": "queued",
            "progress": 0,
            "current_step": None,
            "error": None,
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "eta_seconds": None
        }
        
        self.jobs[job_id] = job
        self._save_jobs()
        return job
    
    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        current_step: Optional[str] = None,
        error: Optional[str] = None,
        eta_seconds: Optional[float] = None
    ):
        """Update job status and progress."""
        if job_id not in self.jobs:
            # Auto-create job
            self.jobs[job_id] = {
                "job_id": job_id,
                "run_id": job_id,
                "status": "queued",
                "progress": 0,
                "current_step": None,
                "error": None,
                "created_at": datetime.now().isoformat(),
                "started_at": None,
                "completed_at": None,
                "eta_seconds": None
            }
        
        job = self.jobs[job_id]
        
        if status:
            job["status"] = status
            if status == "running" and not job["started_at"]:
                job["started_at"] = datetime.now().isoformat()
            elif status in ["success", "failed", "stopped"]:
                job["completed_at"] = datetime.now().isoformat()
        
        if progress is not None:
            job["progress"] = progress
            
            # Calculate ETA based on progress
            if job["started_at"] and progress > 0:
                started = datetime.fromisoformat(job["started_at"])
                elapsed = (datetime.now() - started).total_seconds()
                if progress < 100:
                    estimated_total = elapsed / (progress / 100)
                    job["eta_seconds"] = estimated_total - elapsed
        
        if current_step:
            job["current_step"] = current_step
        
        if error:
            job["error"] = error
        
        if eta_seconds is not None:
            job["eta_seconds"] = eta_seconds
        
        self._save_jobs()
    
    def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get status for a job."""
        return self.jobs.get(job_id)
    
    def list_jobs(self, status_filter: Optional[str] = None) -> list:
        """List all jobs, optionally filtered by status."""
        jobs = list(self.jobs.values())
        
        if status_filter:
            jobs = [j for j in jobs if j["status"] == status_filter]
        
        # Sort by creation time, newest first
        jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        
        return jobs
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job entry."""
        if job_id in self.jobs:
            del self.jobs[job_id]
            self._save_jobs()
            return True
        return False
