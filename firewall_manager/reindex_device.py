#!/usr/bin/env python
# -*- coding: utf-8 -*-
import asyncio
import os
import sys
import argparse
from sqlalchemy.ext.asyncio import AsyncSession

# Add the project root directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from firewall_manager.app.db.session import SessionLocal
from firewall_manager.app import crud
from firewall_manager.app.services.policy_indexer import rebuild_policy_indices

async def reindex_device(device_id: int):
    """
    Retrieves all policies for a given device and runs the policy indexer service.
    """
    print(f"Starting re-indexing for device ID: {device_id}")

    db: AsyncSession = SessionLocal()

    try:
        device = await crud.device.get_device(db, device_id=device_id)
        if not device:
            print(f"Error: Device with ID {device_id} not found.")
            return

        print(f"Found device: {device.name} ({device.vendor})")

        policies = await crud.policy.get_policies_by_device(db, device_id=device_id)

        if not policies:
            print("No policies found for this device. Nothing to index.")
            return

        policy_count = len(policies)
        print(f"Found {policy_count} policies to re-index.")

        await rebuild_policy_indices(db, device_id=device_id, policies=policies)

        # Manually commit the session as this is a standalone script
        await db.commit()

        print(f"\nSuccessfully re-indexed {policy_count} policies for device ID: {device_id}.")

    except Exception as e:
        print(f"An error occurred during re-indexing: {e}")
        await db.rollback()
    finally:
        await db.close()

def main():
    """
    Main function to parse arguments and run the async re-indexing task.
    """
    parser = argparse.ArgumentParser(description="Re-index all policies for a specific device.")
    parser.add_argument("device_id", type=int, help="The ID of the device to re-index.")

    args = parser.parse_args()

    # Running the async function
    try:
        asyncio.run(reindex_device(args.device_id))
    except KeyboardInterrupt:
        print("\nRe-indexing process interrupted by user.")

if __name__ == "__main__":
    main()
