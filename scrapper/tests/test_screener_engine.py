import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from screener.db.models import Base, DerivedMetrics
from screener.engine import ScreenerEngine

# Fixture to create an in-memory SQLite database for testing
@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    
    # Seed some dummy data
    data = [
        DerivedMetrics(symbol="TEST1.NS", pe_ttm=10.5, roe=20.0, market_cap=5000000000),
        DerivedMetrics(symbol="TEST2.NS", pe_ttm=25.0, roe=10.0, market_cap=100000000),
        DerivedMetrics(symbol="TEST3.NS", pe_ttm=14.0, roe=16.0, market_cap=2000000000),
    ]
    session.add_all(data)
    session.commit()
    
    yield session
    session.close()

def test_ast_valid_and_query(db_session):
    ast = {
        "AND": [
            {"field": "pe_ttm", "op": "<", "value": 15},
            {"field": "roe", "op": ">", "value": 15}
        ]
    }
    
    condition = ScreenerEngine.parse_condition(ast)
    results = db_session.query(DerivedMetrics).filter(condition).all()
    assert len(results) == 2
    symbols = [r.symbol for r in results]
    assert "TEST1.NS" in symbols
    assert "TEST3.NS" in symbols

def test_ast_single_rule(db_session):
    ast = {
        "AND": [
            {"field": "market_cap", "op": ">", "value": 1000000000}
        ]
    }
    
    condition = ScreenerEngine.parse_condition(ast)
    results = db_session.query(DerivedMetrics).filter(condition).all()
    assert len(results) == 2
    symbols = [r.symbol for r in results]
    assert "TEST1.NS" in symbols
    assert "TEST3.NS" in symbols

def test_ast_invalid_operator(db_session):
    ast = {
        "AND": [
            {"field": "pe_ttm", "op": "DROP TABLE", "value": 15}
        ]
    }
    
    with pytest.raises(ValueError, match="Operator DROP TABLE is not allowed"):
        ScreenerEngine.parse_condition(ast)

def test_ast_invalid_field(db_session):
    ast = {
        "AND": [
            {"field": "secret_column_does_not_exist", "op": "<", "value": 15}
        ]
    }
    
    with pytest.raises(ValueError, match="Field secret_column_does_not_exist is not allowed"):
        ScreenerEngine.parse_condition(ast)

def test_ast_empty_query(db_session):
    ast = {}
    with pytest.raises(ValueError, match="Field None is not allowed"):
        ScreenerEngine.parse_condition(ast)
