import sys
import pytest

sys.path.insert(0, "/app")


@pytest.fixture(scope="session")
def mt_model():
    from ml.model_loader import ModelLoader

    return ModelLoader().get_model("microtubule")
