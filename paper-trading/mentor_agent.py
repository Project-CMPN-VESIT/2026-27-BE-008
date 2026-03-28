import os
import logging
from dotenv import load_dotenv, find_dotenv


def _resolve_mistral_client_class():
    try:
        from mistralai import Mistral as MistralClient

        return MistralClient
    except Exception:
        pass

    try:
        from mistralai.client import Mistral as MistralClient

        return MistralClient
    except Exception:
        return None

load_dotenv(find_dotenv(usecwd=True))
logger = logging.getLogger(__name__)
MistralClientClass = _resolve_mistral_client_class()

MODEL = "mistral-small-latest"

MENTOR_PROMPT = """You are the FinPilot AI Mentor, evaluating a user's simulated trade using Warren Buffett's framework. 
The user wants to {action} {quantity} shares of {ticker}. 
The SEBI Shield RK Score is {rk_score}. 
The PL Score is {pl_score}. 
The user's thesis is: '{user_thesis}'. 

Critique their logic in 3 short sentences. If the RK score is low due to management sanctions, heavily warn them."""

class MentorAgent:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("MISTRAL_API_KEY")
        self.client = None

        if not self.api_key:
            logger.warning("MISTRAL_API_KEY not set. Mentor Agent will return fallback message.")
            return

        if MistralClientClass is None:
            logger.error("mistralai SDK is installed but Mistral client class could not be resolved.")
            return

        try:
            self.client = MistralClientClass(api_key=self.api_key)
        except Exception as exc:
            logger.error(f"Failed to initialize Mistral client: {exc}")
            self.client = None

    @staticmethod
    def _extract_message_content(response) -> str | None:
        try:
            choices = getattr(response, "choices", None)
            if choices and len(choices) > 0:
                message = getattr(choices[0], "message", None)
                content = getattr(message, "content", None)
                if isinstance(content, str) and content.strip():
                    return content.strip()
        except Exception:
            pass

        if isinstance(response, dict):
            try:
                choices = response.get("choices") or []
                if choices:
                    message = choices[0].get("message") or {}
                    content = message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
            except Exception:
                return None

        return None

    def evaluate_trade(self, action: str, quantity: int, ticker: str, rk_score: float, pl_score: float, user_thesis: str) -> str:
        if not self.api_key or self.client is None:
            return "Unable to reach mentor (API key missing). Proceed with extreme caution."
        
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

            content = self._extract_message_content(response)
            if content:
                return content

            return "Mentor response was empty. Proceed with extreme caution."
        except Exception as e:
            logger.error(f"Mentor AI error: {e}")
            return "Unable to reach mentor server. Proceed with extreme caution."
