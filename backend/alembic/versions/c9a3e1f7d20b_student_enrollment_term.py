"""student enrollment term

Adds `students.enrollment_term_id` (doc 08): the term a student joined in,
set the first time they are placed into a section. Used to bill a mid-year
joiner only from their join term onward and to hide earlier terms from
their Term Fee History.

Revision ID: c9a3e1f7d20b
Revises: b7f2c9d1a4e6
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9a3e1f7d20b'
down_revision: Union[str, Sequence[str], None] = 'b7f2c9d1a4e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Batch mode: SQLite can't ALTER TABLE to add a FK constraint, so alembic
    # rebuilds the table via copy-and-move.
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                'enrollment_term_id',
                sa.String(length=36),
                sa.ForeignKey('terms.id', name='fk_students_enrollment_term_id_terms'),
                nullable=True,
            )
        )
        batch_op.create_index(
            batch_op.f('ix_students_enrollment_term_id'), ['enrollment_term_id'], unique=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('students', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_students_enrollment_term_id'))
        batch_op.drop_column('enrollment_term_id')
