"""Verify Firebase identity tokens on the independently reachable CYRO API."""

from __future__ import annotations

import os
from typing import Optional

import firebase_admin
from firebase_admin import auth, credentials
from fastapi import HTTPException


def _admin_app():
    try:
        return firebase_admin.get_app()
    except ValueError:
        project_id = os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        client_email = os.getenv("FIREBASE_CLIENT_EMAIL")
        private_key = os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n")
        if client_email and private_key and project_id:
            cred = credentials.Certificate({
                "type": "service_account", "project_id": project_id,
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID", ""),
                "private_key": private_key, "client_email": client_email,
                "client_id": os.getenv("FIREBASE_CLIENT_ID", ""),
                "token_uri": "https://oauth2.googleapis.com/token",
            })
        elif os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
            cred = credentials.Certificate(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
        else:
            cred = credentials.ApplicationDefault()
        return firebase_admin.initialize_app(cred, options={"projectId": project_id} if project_id else None)


def require_firebase_user(authorization: Optional[str], forwarded_uid: Optional[str] = None) -> dict:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in is required")
    try:
        decoded = auth.verify_id_token(token, app=_admin_app())
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in token") from exc
    uid = str(decoded.get("uid", ""))
    if not uid or (forwarded_uid and forwarded_uid != uid):
        raise HTTPException(status_code=401, detail="Identity mismatch")
    return {"uid": uid, "email": decoded.get("email"), "name": decoded.get("name"), "picture": decoded.get("picture")}
