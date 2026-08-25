from collections.abc import Callable

from fastapi.testclient import TestClient


def test_creating_academic_year_prefills_three_term_template(
    client: TestClient, login_as: Callable[[str], dict]
) -> None:
    headers = login_as("admin")
    response = client.post(
        "/api/v1/academic-years",
        json={"name": "2027", "start_date": "2027-01-01", "end_date": "2027-12-31"},
        headers=headers,
    )
    assert response.status_code == 201
    body = response.json()
    assert [t["name"] for t in body["terms"]] == ["Term 1", "Term 2", "Term 3"]
    assert [t["term_number"] for t in body["terms"]] == [1, 2, 3]


def test_term_structure_is_not_hardcoded(client: TestClient, login_as: Callable[[str], dict]) -> None:
    """doc 01/05: term count/structure is fully admin-configurable, not
    locked at 3 — this is the corrected behavior from the earlier design.
    """
    headers = login_as("admin")
    year_resp = client.post(
        "/api/v1/academic-years",
        json={"name": "2028", "start_date": "2028-01-01", "end_date": "2028-12-31"},
        headers=headers,
    )
    year_id = year_resp.json()["id"]

    # Add a 4th term.
    add_resp = client.post(
        f"/api/v1/academic-years/{year_id}/terms",
        json={"term_number": 4, "name": "Term 4"},
        headers=headers,
    )
    assert add_resp.status_code == 201

    # Rename a term.
    term_id = year_resp.json()["terms"][0]["id"]
    rename_resp = client.patch(f"/api/v1/terms/{term_id}", json={"name": "Semester 1"}, headers=headers)
    assert rename_resp.status_code == 200
    assert rename_resp.json()["name"] == "Semester 1"

    # Delete a term.
    delete_resp = client.delete(f"/api/v1/terms/{term_id}", headers=headers)
    assert delete_resp.status_code == 204


def test_teacher_cannot_create_academic_year(client: TestClient, login_as: Callable[[str], dict]) -> None:
    headers = login_as("teacher")
    response = client.post(
        "/api/v1/academic-years",
        json={"name": "2029", "start_date": "2029-01-01", "end_date": "2029-12-31"},
        headers=headers,
    )
    assert response.status_code == 403
