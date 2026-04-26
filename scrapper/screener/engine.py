import logging
from typing import Dict, Any, List, Tuple
from sqlalchemy import and_, or_
from .db.models import DerivedMetrics

logger = logging.getLogger(__name__)

class ScreenerEngine:
    ALLOWED_FIELDS = {
        "symbol": DerivedMetrics.symbol,
        "market_cap": DerivedMetrics.market_cap,
        "pe_ttm": DerivedMetrics.pe_ttm,
        "pb": DerivedMetrics.pb,
        "roe": DerivedMetrics.roe,
        "roce": DerivedMetrics.roce,
        "debt_equity": DerivedMetrics.debt_equity,
        "dividend_yield": DerivedMetrics.dividend_yield,
        "sales_growth_5y": DerivedMetrics.sales_growth_5y,
        "profit_growth_5y": DerivedMetrics.profit_growth_5y,
        "current_price": DerivedMetrics.current_price
    }

    ALLOWED_OPS = {"<", "<=", ">", ">=", "==", "!=", "IN"}

    @classmethod
    def parse_condition(cls, condition: Dict[str, Any]) -> Any:
        if "AND" in condition:
            return and_(*[cls.parse_condition(c) for c in condition["AND"]])
        if "OR" in condition:
            return or_(*[cls.parse_condition(c) for c in condition["OR"]])

        field_name = condition.get("field")
        op = condition.get("op")
        value = condition.get("value")

        if field_name not in cls.ALLOWED_FIELDS:
            raise ValueError(f"Field {field_name} is not allowed or does not exist.")
        if op not in cls.ALLOWED_OPS:
            raise ValueError(f"Operator {op} is not allowed.")

        column = cls.ALLOWED_FIELDS[field_name]
        
        if op == "<": return column < value
        if op == "<=": return column <= value
        if op == ">": return column > value
        if op == ">=": return column >= value
        if op == "==": return column == value
        if op == "!=": return column != value
        if op == "IN": return column.in_(value)

    @classmethod
    def generate_explanations(cls, results: List[DerivedMetrics], ast: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Deterministic Explainability Layer
        Returns the matching results along with an explanation of which rules passed.
        """
        explained_results = []
        
        # Flatten AST to simple rules for explanation (simplified for Phase 1)
        # Assuming simple AND list for basic explainability in Phase 1
        rules = ast.get("AND", [ast]) if "OR" not in ast else []
        
        for record in results:
            explanation = {"matched_rules": {}}
            for rule in rules:
                if "field" in rule:
                    field = rule["field"]
                    actual_val = getattr(record, field, None)
                    explanation["matched_rules"][f"{field} {rule['op']} {rule['value']}"] = {
                        "actual_value": actual_val,
                        "status": "pass"
                    }
                    
            explained_results.append({
                "symbol": record.symbol,
                "metrics": {k: getattr(record, k) for k in cls.ALLOWED_FIELDS.keys()},
                "explanation": explanation
            })
            
        return explained_results
