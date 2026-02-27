"""Fine-tune DeBERTa-v3-large-mnli on weak-labeled economics claim validation data.

Prerequisites:
    1. Run generate_weak_labels.py first to produce data/weak_labels/weak_labeled.json
    2. Have at least 500 labeled pairs (1000+ recommended)
    3. ~8GB RAM for CPU training; GPU strongly recommended for speed

Usage:
    uv run python notebooks/finetune_tier1.py \
        --data data/weak_labels/weak_labeled.json \
        --output models/deberta-finetuned \
        --epochs 3

After fine-tuning, update configs/default.yaml:
    tier1:
      model_name: "models/deberta-finetuned"

Then re-run the feasibility check to compare off-the-shelf vs fine-tuned:
    uv run python -m herald.notebooks.feasibility_check
"""

import argparse
import json
from pathlib import Path

import numpy as np
from datasets import Dataset
from sklearn.metrics import accuracy_score, classification_report
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    Trainer,
    TrainingArguments,
)


# NLI label mapping: matches DeBERTa-v3-large-mnli label ordering
# 0=contradiction → invalid, 1=neutral → ambiguous, 2=entailment → valid
LABEL_TO_ID = {"invalid": 0, "ambiguous": 1, "valid": 2}
ID_TO_LABEL = {v: k for k, v in LABEL_TO_ID.items()}
NLI_NAMES = {0: "contradiction", 1: "neutral", 2: "entailment"}


def load_data(data_path: str) -> list[dict]:
    with open(data_path) as f:
        raw = json.load(f)

    records = []
    skipped = 0
    for item in raw:
        label = item.get("label", "").lower().strip()
        if label not in LABEL_TO_ID:
            skipped += 1
            continue
        records.append({
            "premise": item["source"],
            "hypothesis": item["claim"],
            "label": LABEL_TO_ID[label],
        })

    print(f"Loaded {len(records)} records ({skipped} skipped — unknown labels)")
    dist = {}
    for r in records:
        dist[ID_TO_LABEL[r["label"]]] = dist.get(ID_TO_LABEL[r["label"]], 0) + 1
    print(f"Label distribution: {dist}")
    return records


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    acc = accuracy_score(labels, predictions)
    return {"accuracy": acc}


def main():
    parser = argparse.ArgumentParser(description="Fine-tune DeBERTa on weak-labeled data")
    parser.add_argument("--data", default="data/weak_labels/weak_labeled.json")
    parser.add_argument("--output", default="models/deberta-finetuned")
    parser.add_argument("--base-model", default="microsoft/deberta-v3-large-mnli")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--test-size", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print("HERALD — DeBERTa Fine-Tuning")
    print(f"{'='*60}")
    print(f"Base model:  {args.base_model}")
    print(f"Data:        {args.data}")
    print(f"Output:      {args.output}")
    print(f"Epochs:      {args.epochs}, Batch: {args.batch_size}, LR: {args.lr}")

    records = load_data(args.data)
    if len(records) < 100:
        print(f"\nWARNING: Only {len(records)} training examples. Results may be poor.")
        print("Recommendation: Generate at least 500 pairs before fine-tuning.")

    dataset = Dataset.from_list(records).train_test_split(
        test_size=args.test_size, seed=args.seed
    )
    print(f"\nTrain: {len(dataset['train'])}, Test: {len(dataset['test'])}")

    print(f"\nLoading tokenizer from {args.base_model}...")
    tokenizer = AutoTokenizer.from_pretrained(args.base_model)

    def tokenize(batch):
        return tokenizer(
            batch["premise"],
            batch["hypothesis"],
            truncation=True,
            max_length=args.max_length,
            padding="max_length",
        )

    print("Tokenizing dataset...")
    tokenized = dataset.map(tokenize, batched=True, remove_columns=["premise", "hypothesis"])

    print(f"\nLoading model from {args.base_model}...")
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model,
        num_labels=3,
        ignore_mismatched_sizes=True,  # allows loading mnli weights into 3-class head
    )

    training_args = TrainingArguments(
        output_dir=args.output,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        learning_rate=args.lr,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        logging_steps=50,
        warmup_ratio=0.1,
        seed=args.seed,
        report_to="none",  # disable wandb/tensorboard by default
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["test"],
        compute_metrics=compute_metrics,
    )

    print("\nStarting training...")
    trainer.train()

    # Evaluate on test set
    print("\nEvaluating on test set...")
    predictions = trainer.predict(tokenized["test"])
    pred_labels = np.argmax(predictions.predictions, axis=-1)
    true_labels = predictions.label_ids

    print("\nClassification Report:")
    print(classification_report(
        true_labels,
        pred_labels,
        target_names=["invalid", "ambiguous", "valid"],
    ))

    # Save model
    Path(args.output).mkdir(parents=True, exist_ok=True)
    trainer.save_model(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"\nModel saved to {args.output}")

    print(f"\n{'='*60}")
    print("NEXT STEPS:")
    print(f"  1. Update configs/default.yaml: tier1.model_name = '{args.output}'")
    print("  2. Re-run feasibility check to compare models:")
    print("     uv run python -m herald.notebooks.feasibility_check")
    print("  3. Run full pipeline with fine-tuned model:")
    print("     uv run python -m herald.pipeline.run --input data/test_sets/sample_cases.json -v")


if __name__ == "__main__":
    main()
