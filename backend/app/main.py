from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.routers import academics_core, auth, school_settings, system_settings, users

app = FastAPI(title="EduManage API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(auth.router)
app.include_router(school_settings.router)
app.include_router(system_settings.router)
app.include_router(academics_core.router)
app.include_router(users.router)


@app.get("/api/v1/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}
