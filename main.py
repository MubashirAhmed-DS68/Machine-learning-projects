from fastapi import FastAPI
import pandas as pd
from pydantic import BaseModel, Field
import joblib
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))





app = FastAPI()

app.add_middleware(
CORSMiddleware , 
allow_origins=["*"],
allow_methods=["*"],
allow_headers=['*']

)
COLUMNS = [
    'neighbourhood_group',
    'neighbourhood',
    'latitude',
    'longitude',
    'price',
    'minimum_nights',
    'number_of_reviews',
    'reviews_per_month',
    'calculated_host_listings_count',
    'availability_365'
]


class Features(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="Latitude coordinate")
    longitude: float = Field(..., ge=-180, le=180, description="Longitude coordinate")
    price: float = Field(..., gt=0, description="Price per night, must be positive")
    minimum_nights: int = Field(..., ge=1, le=365, description="Minimum nights required for booking")
    number_of_reviews: int = Field(..., ge=0, description="Total number of reviews")
    reviews_per_month: float = Field(..., ge=0, description="Average reviews per month")
    calculated_host_listings_count: int = Field(..., ge=0, description="Number of listings by this host")
    availability_365: int = Field(..., ge=0, le=365, description="Days available out of 365")
    neighbourhood_group: str = Field(..., min_length=1, description="Borough or neighbourhood group")
    neighbourhood: str = Field(..., min_length=1, description="Specific neighbourhood name")


model =  joblib.load("Model_pipeline.pkl")

@app.get('/')
def home():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get('/style.css')
def get_css():
    return FileResponse(os.path.join(BASE_DIR, "style.css"))

@app.get('/script.js')
def get_js():
    return FileResponse(os.path.join(BASE_DIR, "script.js"))





@app.post("/predict",summary="Airbnb Room Type Predict")


def predict(features: Features):
    row = pd.DataFrame([features.model_dump()], columns= COLUMNS)
    prediction = model.predict(row)
    probability = model.predict_proba(row)

    return {

        "predict_room_type":prediction[0],
        "probability :": probability.tolist()[0]
    }






