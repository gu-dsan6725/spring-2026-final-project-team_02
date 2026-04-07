"""Generate HERALD architecture diagram and NLI separation chart."""
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patheffects as pe
import numpy as np
import os

OUT = os.path.join(os.path.dirname(__file__), "../results/plots")
os.makedirs(OUT, exist_ok=True)

# ── 1. Architecture Diagram ──────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 11))
ax.set_xlim(0, 10)
ax.set_ylim(0, 11)
ax.axis("off")
fig.patch.set_facecolor("#F8F9FA")

COLORS = {
    "input":  "#4A90D9",
    "tier1":  "#27AE60",
    "tier2":  "#F39C12",
    "tier3":  "#8E44AD",
    "tier4":  "#E74C3C",
    "output": "#2C3E50",
    "stop":   "#1ABC9C",
    "arrow":  "#555555",
}

def box(ax, x, y, w, h, color, label, sublabel="", alpha=0.92):
    rect = FancyBboxPatch((x, y), w, h,
                          boxstyle="round,pad=0.08",
                          facecolor=color, edgecolor="white",
                          linewidth=1.5, alpha=alpha, zorder=3)
    ax.add_patch(rect)
    ax.text(x + w/2, y + h/2 + (0.12 if sublabel else 0), label,
            ha="center", va="center", fontsize=10, fontweight="bold",
            color="white", zorder=4)
    if sublabel:
        ax.text(x + w/2, y + h/2 - 0.2, sublabel,
                ha="center", va="center", fontsize=7.5,
                color="white", alpha=0.88, zorder=4)

def arrow(ax, x1, y1, x2, y2, label="", color="#555555"):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color,
                                lw=1.8, mutation_scale=14),
                zorder=2)
    if label:
        mx, my = (x1+x2)/2, (y1+y2)/2
        ax.text(mx + 0.12, my, label, fontsize=8, color=color,
                va="center", zorder=5)

def side_arrow(ax, x1, y1, x2, y2, label="", color=COLORS["stop"]):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color,
                                lw=1.6, mutation_scale=12,
                                connectionstyle="arc3,rad=0"),
                zorder=2)
    if label:
        ax.text((x1+x2)/2 + 0.15, (y1+y2)/2, label,
                fontsize=7.5, color=color, va="center", zorder=5)

# Title
ax.text(5, 10.55, "HERALD Validation Pipeline", ha="center", va="center",
        fontsize=14, fontweight="bold", color="#2C3E50")

# Input box
box(ax, 2.5, 9.6, 5, 0.7, COLORS["input"],
    "Economics Agent Output",
    "CheckpointOutput { type, output_text, source_context, query }")

# Arrow down to T1
arrow(ax, 5, 9.6, 5, 8.85, color=COLORS["arrow"])

# Tier 1
box(ax, 1.2, 7.9, 7.6, 0.9, COLORS["tier1"],
    "Tier 1 — NLI Classifier (Local, $0)",
    "cross-encoder/nli-deberta-v3-large  |  CPU  |  T1 = 0.70  |  ~0.5s/case")

# T1 → STOP (right)
side_arrow(ax, 8.8, 8.35, 9.5, 8.35, color=COLORS["stop"])
ax.text(9.55, 8.35, "STOP\nVERDICT", fontsize=7.5, color=COLORS["stop"],
        va="center", fontweight="bold")
ax.text(8.82, 8.65, "conf ≥ 0.70", fontsize=7, color=COLORS["stop"], va="bottom")

# T1 → T2
arrow(ax, 5, 7.9, 5, 7.1, color=COLORS["arrow"])
ax.text(5.12, 7.5, "conf < 0.70", fontsize=7.5, color="#888", va="center")

# Tier 2
box(ax, 1.2, 6.1, 7.6, 0.9, COLORS["tier2"],
    "Tier 2 — LLM Judge (Groq Free)",
    "llama-3.3-70b-versatile  |  temp=0.1  |  T2 = 0.80  |  ~2s/case")

# T2 → STOP
side_arrow(ax, 8.8, 6.55, 9.5, 6.55, color=COLORS["stop"])
ax.text(9.55, 6.55, "STOP\nVERDICT", fontsize=7.5, color=COLORS["stop"],
        va="center", fontweight="bold")
ax.text(8.82, 6.85, "conf ≥ 0.80", fontsize=7, color=COLORS["stop"], va="bottom")

# T2 → T3
arrow(ax, 5, 6.1, 5, 5.3, color=COLORS["arrow"])
ax.text(5.12, 5.7, "conf < 0.80", fontsize=7.5, color="#888", va="center")

# Tier 3 — outer box
box(ax, 1.2, 3.3, 7.6, 1.9, COLORS["tier3"],
    "", "")

# Tier 3 label at top
ax.text(5, 5.1, "Tier 3 — Multi-Agent Debate (Groq Free, 3 calls, ~6s/case)",
        ha="center", va="center", fontsize=9.5, fontweight="bold",
        color="white", zorder=5)

# Three sub-agents
sub_w, sub_h = 2.0, 0.65
sub_y = 3.5
sub_colors = ["#6C3483", "#5B2C6F", "#4A235A"]
sub_labels = [("Advocate", "Argues VALID\ntemp=0.3"),
              ("Critic", "Argues INVALID\ntemp=0.3"),
              ("Judge", "Weighs evidence\ntemp=0.1 → JSON")]
for i, (lbl, sub) in enumerate(sub_labels):
    sx = 1.6 + i * 2.55
    rect = FancyBboxPatch((sx, sub_y), sub_w, sub_h,
                          boxstyle="round,pad=0.06",
                          facecolor=sub_colors[i], edgecolor="white",
                          linewidth=1.2, alpha=0.95, zorder=4)
    ax.add_patch(rect)
    ax.text(sx + sub_w/2, sub_y + sub_h/2 + 0.1, lbl,
            ha="center", va="center", fontsize=9, fontweight="bold",
            color="white", zorder=5)
    ax.text(sx + sub_w/2, sub_y + sub_h/2 - 0.15, sub,
            ha="center", va="center", fontsize=7, color="white",
            alpha=0.88, zorder=5)

# Arrows between sub-agents
ax.annotate("", xy=(4.15, sub_y + sub_h/2), xytext=(3.6, sub_y + sub_h/2),
            arrowprops=dict(arrowstyle="-|>", color="white", lw=1.3), zorder=5)
ax.annotate("", xy=(6.7, sub_y + sub_h/2), xytext=(6.15, sub_y + sub_h/2),
            arrowprops=dict(arrowstyle="-|>", color="white", lw=1.3), zorder=5)

# T3 → STOP
side_arrow(ax, 8.8, 4.25, 9.5, 4.25, color=COLORS["stop"])
ax.text(9.55, 4.25, "STOP\nVERDICT", fontsize=7.5, color=COLORS["stop"],
        va="center", fontweight="bold")
ax.text(8.82, 4.55, "conf ≥ T3", fontsize=7, color=COLORS["stop"], va="bottom")

# T3 → T4
arrow(ax, 5, 3.3, 5, 2.55, color=COLORS["arrow"])
ax.text(5.12, 2.93, "uncertain", fontsize=7.5, color="#888", va="center")

# Tier 4
box(ax, 1.2, 1.6, 7.6, 0.85, COLORS["tier4"],
    "Tier 4 — Human Review",
    "Generates review packet (JSON) with full reasoning trace  |  Portal: pending")

# Output / EscalationPacket label at bottom
ax.text(5, 1.25, "→  EscalationPacket  { checkpoint, tier1_result, tier2_result, tier3_result, resolved_at_tier, final_verdict }",
        ha="center", va="center", fontsize=7.8, color="#555", style="italic")

# Legend — cost bar
ax.text(0.3, 0.75, "Cost per case:", fontsize=8, color="#555", fontweight="bold")
for i, (label, color) in enumerate([
    ("T1: $0 local", COLORS["tier1"]),
    ("T2: $0 Groq free", COLORS["tier2"]),
    ("T3: $0 Groq free", COLORS["tier3"]),
    ("T4: ~$5 human", COLORS["tier4"]),
]):
    patch = mpatches.Patch(facecolor=color, label=label)
    ax.text(1.8 + i * 2.0, 0.75, label, fontsize=7.5, color=color,
            va="center", fontweight="bold")

plt.tight_layout(pad=0.5)
out_path = os.path.join(OUT, "architecture.png")
fig.savefig(out_path, dpi=160, bbox_inches="tight", facecolor=fig.get_facecolor())
print(f"Saved: {out_path}")
plt.close(fig)

# ── 2. NLI Separation Chart ───────────────────────────────────────────────────
fig2, ax2 = plt.subplots(figsize=(7, 3.5))
fig2.patch.set_facecolor("#F8F9FA")
ax2.set_facecolor("#F8F9FA")

labels = ["Valid (n=17)", "Invalid (n=15)", "Ambiguous (n=8)"]
ent_scores = [0.680, 0.135, 0.124]
con_scores = [0.001, 0.369, 0.015]

x = np.arange(len(labels))
w = 0.32
bars1 = ax2.bar(x - w/2, ent_scores, w, label="Mean Entailment",
                color=COLORS["tier1"], alpha=0.88, edgecolor="white", linewidth=0.8)
bars2 = ax2.bar(x + w/2, con_scores, w, label="Mean Contradiction",
                color=COLORS["tier4"], alpha=0.88, edgecolor="white", linewidth=0.8)

for bar in bars1:
    h = bar.get_height()
    ax2.text(bar.get_x() + bar.get_width()/2, h + 0.012, f"{h:.3f}",
             ha="center", va="bottom", fontsize=9, color=COLORS["tier1"], fontweight="bold")
for bar in bars2:
    h = bar.get_height()
    ax2.text(bar.get_x() + bar.get_width()/2, h + 0.012, f"{h:.3f}",
             ha="center", va="bottom", fontsize=9, color=COLORS["tier4"], fontweight="bold")

# Gap annotation
ax2.annotate("", xy=(x[0] - w/2, 0.680), xytext=(x[1] - w/2, 0.135),
             arrowprops=dict(arrowstyle="<->", color="#888", lw=1.5))
ax2.text(0.15, 0.41, "gap\n= 0.545", fontsize=8, color="#888",
         ha="center", va="center", style="italic")

ax2.set_xticks(x)
ax2.set_xticklabels(labels, fontsize=10)
ax2.set_ylabel("DeBERTa NLI Score", fontsize=10)
ax2.set_title("Feasibility Gate — NLI Separation by Label\n(cross-encoder/nli-deberta-v3-large, 40 cases)",
              fontsize=11, fontweight="bold", color="#2C3E50")
ax2.set_ylim(0, 0.82)
ax2.legend(fontsize=9, framealpha=0.7)
ax2.spines[["top", "right"]].set_visible(False)
ax2.grid(axis="y", alpha=0.3)

plt.tight_layout()
out2 = os.path.join(OUT, "nli_separation.png")
fig2.savefig(out2, dpi=160, bbox_inches="tight", facecolor=fig2.get_facecolor())
print(f"Saved: {out2}")
plt.close(fig2)

print("Done.")
