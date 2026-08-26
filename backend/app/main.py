from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.routers import (
    academic_performance,
    academics_core,
    attendance,
    auth,
    examinations,
    fee_financial,
    school_settings,
    staff_management,
    student_information,
    system_settings,
    users,
)

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
app.include_router(student_information.router)
app.include_router(staff_management.router)
app.include_router(attendance.router)
app.include_router(fee_financial.router)
app.include_router(academic_performance.router)
app.include_router(examinations.router)


@app.get("/api/v1/health", tags=["health"])
def health() -> dict:
    return {"status": "ok"}
