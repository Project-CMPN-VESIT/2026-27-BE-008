import asyncio
import json
import os
import logging
import tempfile
import shutil
import subprocess
from typing import Optional
from schemas import VideoBrief

logger = logging.getLogger("remotion_agent")

async def render_video(brief: VideoBrief, job_id: str, custom_rel_path: Optional[str] = None) -> str:
    """
    Spawns a subprocess to run the Remotion CLI.
    Writes the VideoBrief to a temporary JSON file to pass as --props.
    Uses asyncio.to_thread with subprocess.run to avoid Windows
    asyncio.create_subprocess_exec NotImplementedError with non-proactor event loops.
    Returns the relative path to the final .mp4 file.
    """
    props_dict = {"videoBrief": brief.model_dump()}
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
    
    # Verify frontend directory exists
    if not os.path.isdir(frontend_dir):
        raise RuntimeError(f"Frontend directory not found: {frontend_dir}")
    
    root_entry = os.path.join(frontend_dir, "src", "remotion", "Root.jsx")
    if not os.path.isfile(root_entry):
        raise RuntimeError(f"Remotion Root.jsx not found at: {root_entry}")
    
    if custom_rel_path:
        # e.g. "videos/nifty-shorts/2026-10-06/RELIANCE.mp4"
        rel_clean = custom_rel_path.lstrip("/\\").replace("/", os.sep).replace("\\", os.sep)
        out_filepath = os.path.normpath(os.path.join(frontend_dir, "public", rel_clean))
        os.makedirs(os.path.dirname(out_filepath), exist_ok=True)
        ret_url = f"/{custom_rel_path.lstrip('/\\').replace(os.sep, '/')}"
    else:
        public_dir = os.path.normpath(os.path.join(frontend_dir, "public", "video", job_id))
        os.makedirs(public_dir, exist_ok=True)
        out_filename = f"{job_id}.mp4"
        out_filepath = os.path.normpath(os.path.join(public_dir, out_filename))
        ret_url = f"/video/{job_id}/{out_filename}"
    
    # Check for npx availability
    npx_cmd = "npx.cmd" if os.name == "nt" else "npx"
    npx_path = shutil.which(npx_cmd)
    if not npx_path:
        # Fallback: try plain npx
        npx_cmd = "npx"
        npx_path = shutil.which(npx_cmd)
    if not npx_path:
        raise RuntimeError("npx/npx.cmd not found on PATH. Ensure Node.js is installed and on the system PATH.")
    
    # `npx remotion` prints the cryptic "could not determine executable to run" when the dependencies were never
    # installed; say what is actually wrong and how to fix it.
    if not os.path.isfile(os.path.join(frontend_dir, "node_modules", "@remotion", "cli", "package.json")):
        raise RuntimeError(
            "Remotion is not installed. Run `npm install` in video-engine/frontend (once), then retry the render."
        )

    logger.info(f"Using npx at: {npx_path}")
    logger.info(f"Frontend dir: {frontend_dir}")
    logger.info(f"Output: {out_filepath}")
    
    props_fp = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json", encoding="utf-8")
    try:
        json.dump(props_dict, props_fp, ensure_ascii=False)
        props_fp.close()
        
        logger.info(f"Props written to: {props_fp.name} ({os.path.getsize(props_fp.name)} bytes)")
        
        # Concurrency=1 avoids CPU 100% starvation and UI lag during rendering
        cmd = [
            npx_cmd,
            "remotion",
            "render",
            "src/remotion/Root.jsx",
            "MainVideo",
            out_filepath,
            "--props",
            props_fp.name,
            "--concurrency=1",
            "--gl=angle",
        ]
        
        logger.info(f"Remotion command: {' '.join(cmd)}")
        
        # Prepare environment with PATH to ensure chrome-headless-shell and node are found
        env = os.environ.copy()

        def _execute_remotion_cli():
            process = subprocess.Popen(
                cmd,
                cwd=frontend_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                env=env,
                text=True,
                encoding="utf-8",
                errors="ignore",
                bufsize=1,
            )
            output_lines = []
            try:
                for line in iter(process.stdout.readline, ""):
                    if not line:
                        break
                    clean_line = line.strip()
                    if clean_line:
                        output_lines.append(clean_line)
                        line_lower = clean_line.lower()
                        if any(k in line_lower for k in ["render", "frame", "bundle", "complete", "error", "progress", "%", "ready", "memory"]):
                            logger.info(f"[Remotion] {clean_line}")
                process.stdout.close()
                returncode = process.wait(timeout=900)
            except subprocess.TimeoutExpired:
                process.kill()
                raise RuntimeError("Remotion render timed out after 900 seconds")
            except Exception as e:
                process.kill()
                raise e
            return returncode, output_lines

        # Run via thread pool to remain fully non-blocking
        returncode, all_lines = await asyncio.to_thread(_execute_remotion_cli)

        if returncode != 0:
            tail = "\n".join(all_lines[-30:])
            raise RuntimeError(
                f"Remotion render failed (exit code {returncode}). Output tail:\n{tail}"
            )
        
        # Verify output file
        if not os.path.exists(out_filepath):
            tail = "\n".join(all_lines[-40:])
            raise RuntimeError(f"Remotion completed but output file not found: {out_filepath}\nOutput:\n{tail}")
        
        file_size = os.path.getsize(out_filepath)
        if file_size < 1000:
            raise RuntimeError(f"Remotion output file is too small ({file_size} bytes): {out_filepath}")
        
        logger.info(f"Render successful: {out_filepath} ({file_size} bytes)")
            
    finally:
        if os.path.exists(props_fp.name):
            try:
                os.remove(props_fp.name)
            except Exception:
                pass
            
    return ret_url
