import os
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()

# Determine JSON type based on dialect (JSONB for Postgres, JSON for others)
database_url = os.getenv("DATABASE_URL", "")
if database_url.startswith("postgres"):
    from sqlalchemy.dialects.postgresql import JSONB
    JSON_TYPE = JSONB
else:
    from sqlalchemy.types import JSON
    JSON_TYPE = JSON

class Company(Base):
    __tablename__ = 'companies'
    
    symbol = Column(String(50), primary_key=True)
    name = Column(String(255), nullable=False)
    sector = Column(String(100))
    industry = Column(String(100))
    data_quality_score = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    derived_metrics = relationship("DerivedMetrics", back_populates="company", uselist=False)
    financial_statements = relationship("FinancialStatement", back_populates="company")

class DerivedMetrics(Base):
    __tablename__ = 'derived_metrics'
    
    symbol = Column(String(50), ForeignKey('companies.symbol'), primary_key=True)
    # Core typed filters (Indexed for fast screening)
    market_cap = Column(Float, index=True)
    pe_ttm = Column(Float, index=True)
    pb = Column(Float, index=True)
    roe = Column(Float, index=True)
    roce = Column(Float, index=True)
    debt_equity = Column(Float, index=True)
    dividend_yield = Column(Float, index=True)
    sales_growth_5y = Column(Float, index=True)
    profit_growth_5y = Column(Float, index=True)
    
    # Prices
    current_price = Column(Float)
    high_52w = Column(Float)
    low_52w = Column(Float)

    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    company = relationship("Company", back_populates="derived_metrics")

class FinancialStatement(Base):
    __tablename__ = 'financial_statements'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(50), ForeignKey('companies.symbol'), index=True)
    period_type = Column(String(10)) # 'ANNUAL' or 'QUARTERLY'
    period_ending = Column(DateTime, index=True)
    
    # JSON/JSONB for flexible payload
    raw_data = Column(JSON_TYPE, nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    company = relationship("Company", back_populates="financial_statements")
    
    __table_args__ = (
        Index('idx_stmt_symbol_period', 'symbol', 'period_type', 'period_ending', unique=True),
    )

class ScreenDefinition(Base):
    __tablename__ = 'screen_definitions'
    
    id = Column(String(50), primary_key=True)
    user_id = Column(String(100), index=True)
    name = Column(String(255), nullable=False)
    query_ast = Column(JSON_TYPE, nullable=False)
    is_preset = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class CustomRatio(Base):
    __tablename__ = 'custom_ratios'
    
    id = Column(String(50), primary_key=True)
    user_id = Column(String(100), index=True)
    name = Column(String(100), nullable=False)
    formula_ast = Column(JSON_TYPE, nullable=False)
    dependencies = Column(JSON_TYPE)
    created_at = Column(DateTime, default=datetime.utcnow)

class Alert(Base):
    __tablename__ = 'alerts'
    
    id = Column(String(50), primary_key=True)
    user_id = Column(String(100), index=True)
    alert_type = Column(String(50))
    condition_ast = Column(JSON_TYPE, nullable=False)
    cooldown_hours = Column(Integer, default=24)
    last_triggered_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
