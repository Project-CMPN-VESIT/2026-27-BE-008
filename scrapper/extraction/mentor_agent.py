import os
import logging
from dotenv import load_dotenv, find_dotenv
from mistralai import Mistral

load_dotenv(find_dotenv(usecwd=True))
logger = logging.getLogger(__name__)

MODEL = "mistral-small-latest"

MENTOR_PROMPT = """You are the FinPilot AI Mentor, evaluating a user's simulated trade using Warren Buffett's framework. 
The user wants to {action} {quantity} shares of {ticker}. 
The SEBI Shield RK Score is {rk_score}. 
The PL Score is {pl_score}. 
The user's thesis is: '{user_thesis}'. 

Critique their logic in 3 short sentences. If the RK score is low due to management sanctions, heavily warn them. End by asking: 'Do you still want to execute this trade?'"""

class MentorAgent:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("MISTRAL_API_KEY")
        if not self.api_key:
            logger.warning("MISTRAL_API_KEY not set. Mentor Agent will return fallback message.")
        else:
            self.client = Mistral(api_key=self.api_key)

    def evaluate_trade(self, action: str, quantity: int, ticker: str, rk_score: float, pl_score: float, user_thesis: str) -> str:
        if not self.api_key:
            return "Unable to reach mentor (API key missing). Proceed with extreme caution. Do you still want to execute this trade?"
        
        prompt = MENTOR_PROMPT.format(
            action=action.upper(),
            quantity=quantity,
            ticker=ticker,
            rk_score=rk_score,
            pl_score=pl_score,
            user_thesis=user_thesis
        )
        
        try:
            response = self.client.chat.complete(
                model=MODEL,
                messages=[
                    {"role": "system", "content": "You are an expert AI mentor in value investing."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            return response.choices[0].message.content
        except Exception as e:
            logger.error(f"Mentor AI error: {e}")
            return "Unable to reach mentor. Proceed with extreme caution. Do you still want to execute this trade?"
