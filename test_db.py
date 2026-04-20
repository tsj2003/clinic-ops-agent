import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import os
from datetime import datetime
from dateutil.relativedelta import relativedelta

async def test():
    client = AsyncIOMotorClient("mongodb+srv://tarandeepjuneja11_db_user:pg8VhKfnmg83dmNU@cluster0.7n3rijz.mongodb.net/?appName=Cluster0")
    db = client.clinic_ops
    days = 30
    start_date = datetime.utcnow() - relativedelta(days=days)
    pipeline = [
        {"$match": {"created_at": {"$gte": start_date}}},
        {"$group": {
            "_id": None,
            "total_denials": {"$sum": 1},
            "appeals_submitted": {"$sum": {"$cond": [{"$eq": ["$status", "submitted"]}, 1, 0]}},
            "resolved": {"$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}},
            "total_billed": {"$sum": "$procedure.billed_amount"},
            "total_recovery": {"$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, "$procedure.billed_amount", 0]}}
        }}
    ]
    try:
        result = await db.denial_claims.aggregate(pipeline).to_list(length=1)
        print("Result:", result)
        stats = result[0] if result else {}
        submitted = stats.get("appeals_submitted", 0)
        resolved = stats.get("resolved", 0)
        success_rate = (resolved / submitted * 100) if submitted > 0 else 0
        total_billed = stats.get("total_billed", 1)
        print(f"Stats: {stats}, Success rate: {success_rate}")
        rec = round((stats.get("total_recovery", 0) / total_billed * 100), 2) if stats.get("total_billed") else 0
        print("Recovery:", rec)
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(test())
