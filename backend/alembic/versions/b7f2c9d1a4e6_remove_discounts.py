"""remove discounts

Removes the fee discount / scholarship feature entirely: the
`student_discounts` and `discounts` tables (doc 05 §5) plus the now-unused
`fee_discount_approval_threshold_cents` row in `system_settings`.

Revision ID: b7f2c9d1a4e6
Revises: e76d45a0189c
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7f2c9d1a4e6'
down_revision: Union[str, Sequence[str], None] = 'e76d45a0189c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f('ix_student_discounts_student_id'), table_name='student_discounts')
    op.drop_index(op.f('ix_student_discounts_discount_id'), table_name='student_discounts')
    op.drop_table('student_discounts')
    op.drop_table('discounts')
    op.execute(
        "DELETE FROM system_settings WHERE key = 'fee_discount_approval_threshold_cents'"
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        'discounts',
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('type', sa.String(length=20), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('applies_to', sa.String(length=20), nullable=False),
        sa.Column('requires_approval', sa.Boolean(), nullable=False),
        sa.Column('approval_threshold_cents', sa.Integer(), nullable=True),
        sa.Column('fee_category_id', sa.String(length=36), nullable=True),
        sa.Column('fee_structure_id', sa.String(length=36), nullable=True),
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['fee_category_id'], ['fee_categories.id'], ),
        sa.ForeignKeyConstraint(['fee_structure_id'], ['fee_structures.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'student_discounts',
        sa.Column('student_id', sa.String(length=36), nullable=False),
        sa.Column('discount_id', sa.String(length=36), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('approved_by', sa.String(length=36), nullable=True),
        sa.Column('approved_at', sa.DateTime(), nullable=True),
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['approved_by'], ['users.id'], ),
        sa.ForeignKeyConstraint(['discount_id'], ['discounts.id'], ),
        sa.ForeignKeyConstraint(['student_id'], ['students.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_student_discounts_discount_id'), 'student_discounts', ['discount_id'], unique=False)
    op.create_index(op.f('ix_student_discounts_student_id'), 'student_discounts', ['student_id'], unique=False)
