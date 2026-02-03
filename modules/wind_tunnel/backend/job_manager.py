#!/usr/bin/env python3
"""
Job Manager for Wind Tunnel GUI

Manages background jobs and provides status tracking.
"""

import asyncio
from typing import Dict, Optional, Callable
from datetime import datetime


class JobManager:
    """Manages background jobs for the application."""
    
    def __init__(self):
        self.jobs: Dict[str, Dict] = {}
    
    def create_job(self, job_id: str, job_type: str) -> str:
        """Create a new job entry."""
        self.jobs[job_id] = {
            "id": job_id,
            "type": job_type,
            "status": "pending",
            "created_at": datetime.now().isoformat(),
            "started_at": None,
            "completed_at": None,
            "progress": 0,
            "message": ""
        }
        return job_id
    
    def start_job(self, job_id: str):
        """Mark a job as started."""
        if job_id in self.jobs:
            self.jobs[job_id]["status"] = "running"
            self.jobs[job_id]["started_at"] = datetime.now().isoformat()
    
    def update_progress(self, job_id: str, progress: int, message: str = ""):
        """Update job progress."""
        if job_id in self.jobs:
            self.jobs[job_id]["progress"] = progress
            self.jobs[job_id]["message"] = message
    
    def complete_job(self, job_id: str, success: bool = True, message: str = ""):
        """Mark a job as completed."""
        if job_id in self.jobs:
            self.jobs[job_id]["status"] = "completed" if success else "failed"
            self.jobs[job_id]["completed_at"] = datetime.now().isoformat()
            self.jobs[job_id]["progress"] = 100 if success else self.jobs[job_id]["progress"]
            self.jobs[job_id]["message"] = message
    
    def get_job_status(self, job_id: str) -> Optional[Dict]:
        """Get the status of a job."""
        return self.jobs.get(job_id)
    
    def list_jobs(self, job_type: Optional[str] = None) -> list:
        """List all jobs, optionally filtered by type."""
        jobs = list(self.jobs.values())
        if job_type:
            jobs = [j for j in jobs if j["type"] == job_type]
        return jobs
    
    def cleanup_old_jobs(self, max_age_hours: int = 24):
        """Remove jobs older than max_age_hours."""
        now = datetime.now()
        to_remove = []
        
        for job_id, job in self.jobs.items():
            if job["completed_at"]:
                try:
                    completed = datetime.fromisoformat(job["completed_at"])
                    age_hours = (now - completed).total_seconds() / 3600
                    if age_hours > max_age_hours:
                        to_remove.append(job_id)
                except:
                    pass
        
        for job_id in to_remove:
            del self.jobs[job_id]
