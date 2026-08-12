#!/usr/bin/env python3
"""
Seize the Day — Expected-Value Matchup Calculator

A self-contained Tkinter application for editing unit profiles, saving them
between sessions, and calculating exact expected activations required to rout
each opposing unit.

Rules modelled:
- Units rout at 7 wounds.
- No exploding sixes.
- Ordinary attacks wound on a die result >= the target's Defence.
- Armour Piercing attacks never need worse than 3+.
- Charge→Melee uses the Charge pool once, then the Melee pool thereafter.
- Shooting is analysed only for units with "Analyse shooting" enabled.

The unit data is stored at:
    ~/.seize_the_day_units.json
"""

from __future__ import annotations

import csv
import json
import math
import tkinter as tk
from dataclasses import asdict, dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Iterable


HP = 7
DATA_FILE = Path.home() / ".seize_the_day_units.json"

DEFAULT_UNITS = [
    {
        "name": "Heavy Infantry", "move": 6, "drill": 0,
        "charge": 3, "charge_ap": False,
        "melee": 5, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 5, "analyse_shooting": False,
    },
    {
        "name": "Infantry", "move": 6, "drill": 2,
        "charge": 3, "charge_ap": False,
        "melee": 4, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 5, "analyse_shooting": False,
    },
    {
        "name": "Spears", "move": 6, "drill": 1,
        "charge": 2, "charge_ap": False,
        "melee": 5, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 6, "analyse_shooting": False,
    },
    {
        "name": "Polearms", "move": 6, "drill": 1,
        "charge": 2, "charge_ap": False,
        "melee": 3, "melee_ap": True,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 4, "analyse_shooting": False,
    },
    {
        "name": "Archers", "move": 6, "drill": 0,
        "charge": 2, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 5, "shoot_ap": False, "range": 18,
        "defence": 3, "analyse_shooting": True,
    },
    {
        "name": "Crossbows", "move": 6, "drill": 0,
        "charge": 2, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 3, "shoot_ap": True, "range": 12,
        "defence": 3, "analyse_shooting": True,
    },
    {
        "name": "Light Infantry", "move": 6, "drill": 3,
        "charge": 3, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 3, "shoot_ap": False, "range": 8,
        "defence": 3, "analyse_shooting": False,
    },
    {
        "name": "Heavy Cavalry", "move": 12, "drill": 0,
        "charge": 5, "charge_ap": False,
        "melee": 3, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 5, "analyse_shooting": False,
    },
    {
        "name": "Cavalry", "move": 12, "drill": 1,
        "charge": 5, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 5, "analyse_shooting": False,
    },
    {
        "name": "Lancers", "move": 12, "drill": 0,
        "charge": 3, "charge_ap": True,
        "melee": 2, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 4, "analyse_shooting": False,
    },
    {
        "name": "Light Cavalry", "move": 12, "drill": 2,
        "charge": 3, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 0, "shoot_ap": False, "range": 0,
        "defence": 3, "analyse_shooting": False,
    },
    {
        "name": "Mounted Archers", "move": 12, "drill": 3,
        "charge": 2, "charge_ap": False,
        "melee": 2, "melee_ap": False,
        "shoot": 3, "shoot_ap": False, "range": 5,
        "defence": 3, "analyse_shooting": True,
    },
]


@dataclass
class Unit:
    name: str
    move: int
    drill: int
    charge: int
    charge_ap: bool
    melee: int
    melee_ap: bool
    shoot: int
    shoot_ap: bool
    range: int
    defence: int
    analyse_shooting: bool

    @classmethod
    def from_dict(cls, data: dict) -> "Unit":
        defaults = {
            "name": "New Unit",
            "move": 6,
            "drill": 1,
            "charge": 2,
            "charge_ap": False,
            "melee": 2,
            "melee_ap": False,
            "shoot": 0,
            "shoot_ap": False,
            "range": 0,
            "defence": 4,
            "analyse_shooting": False,
        }
        defaults.update(data)
        return cls(**defaults)


@dataclass
class MatchupResult:
    attacker: str
    defender: str
    defence: int

    charge_dice: int
    charge_ap: bool
    charge_ev: float
    charge_kill_pct: float

    melee_dice: int
    melee_ap: bool
    melee_ev: float
    melee_attacks_to_kill: float

    charge_then_melee: float

    shoot_dice: int | None
    shoot_ap: bool | None
    shoot_ev: float | None
    shoot_attacks_to_kill: float | None
    shoot_kill_pct: float | None


def hit_probability(defence: int, armour_piercing: bool) -> float:
    """Return the chance that one die wounds."""
    needed = min(defence, 3) if armour_piercing else defence
    needed = max(1, min(7, needed))
    if needed >= 7:
        return 0.0
    return (7 - needed) / 6.0


def binomial_distribution(dice: int, probability: float) -> list[float]:
    """Probability of exactly k wounds for k=0..dice."""
    if dice <= 0:
        return [1.0]
    return [
        math.comb(dice, k)
        * (probability ** k)
        * ((1.0 - probability) ** (dice - k))
        for k in range(dice + 1)
    ]


def expected_wounds(dice: int, defence: int, armour_piercing: bool) -> float:
    return dice * hit_probability(defence, armour_piercing)


def first_attack_kill_probability(
    dice: int,
    defence: int,
    armour_piercing: bool,
    hp: int = HP,
) -> float:
    if dice < hp:
        return 0.0
    distribution = binomial_distribution(
        dice, hit_probability(defence, armour_piercing)
    )
    return sum(distribution[hp:])


def expected_repeated_attacks_to_kill(
    dice: int,
    defence: int,
    armour_piercing: bool,
    hp: int = HP,
) -> float:
    """
    Exact expected number of repeated identical attacks needed to reach hp wounds.

    E[h] = (1 + sum(P(k) E[h-k], k>=1)) / (1-P(0))
    """
    if dice <= 0:
        return math.inf

    probability = hit_probability(defence, armour_piercing)
    if probability <= 0:
        return math.inf

    distribution = binomial_distribution(dice, probability)
    p_zero = distribution[0]
    if p_zero >= 1.0:
        return math.inf

    expected = [0.0] * (hp + 1)
    for remaining in range(1, hp + 1):
        continuation = 0.0
        for wounds in range(1, len(distribution)):
            next_remaining = max(0, remaining - wounds)
            continuation += distribution[wounds] * expected[next_remaining]
        expected[remaining] = (1.0 + continuation) / (1.0 - p_zero)

    return expected[hp]


def expected_charge_then_melee(
    charge_dice: int,
    charge_ap: bool,
    melee_dice: int,
    melee_ap: bool,
    defence: int,
    hp: int = HP,
) -> float:
    """
    Exact expected activations to rout:
    first activation uses Charge, later activations use Melee.
    """
    if charge_dice <= 0:
        return math.inf
    if melee_dice <= 0:
        # The charge can only rout if it does all hp wounds at once.
        kill_probability = first_attack_kill_probability(
            charge_dice, defence, charge_ap, hp
        )
        return 1.0 if kill_probability >= 1.0 else math.inf

    melee_probability = hit_probability(defence, melee_ap)
    melee_distribution = binomial_distribution(melee_dice, melee_probability)
    p_zero = melee_distribution[0]
    if p_zero >= 1.0:
        return math.inf

    # Expected future melee attacks for each remaining HP value.
    melee_expected = [0.0] * (hp + 1)
    for remaining in range(1, hp + 1):
        continuation = 0.0
        for wounds in range(1, len(melee_distribution)):
            next_remaining = max(0, remaining - wounds)
            continuation += (
                melee_distribution[wounds] * melee_expected[next_remaining]
            )
        melee_expected[remaining] = (1.0 + continuation) / (1.0 - p_zero)

    charge_probability = hit_probability(defence, charge_ap)
    charge_distribution = binomial_distribution(charge_dice, charge_probability)

    future = 0.0
    for wounds, chance in enumerate(charge_distribution):
        remaining = max(0, hp - wounds)
        future += chance * melee_expected[remaining]

    return 1.0 + future


def calculate_matchups(units: Iterable[Unit]) -> list[MatchupResult]:
    unit_list = list(units)
    results: list[MatchupResult] = []

    for attacker in unit_list:
        for defender in unit_list:
            charge_ev = expected_wounds(
                attacker.charge, defender.defence, attacker.charge_ap
            )
            melee_ev = expected_wounds(
                attacker.melee, defender.defence, attacker.melee_ap
            )

            shoot_dice: int | None = None
            shoot_ap: bool | None = None
            shoot_ev: float | None = None
            shoot_attacks: float | None = None
            shoot_kill_pct: float | None = None

            if attacker.analyse_shooting and attacker.shoot > 0:
                shoot_dice = attacker.shoot
                shoot_ap = attacker.shoot_ap
                shoot_ev = expected_wounds(
                    attacker.shoot, defender.defence, attacker.shoot_ap
                )
                shoot_attacks = expected_repeated_attacks_to_kill(
                    attacker.shoot, defender.defence, attacker.shoot_ap
                )
                shoot_kill_pct = 100.0 * first_attack_kill_probability(
                    attacker.shoot, defender.defence, attacker.shoot_ap
                )

            results.append(
                MatchupResult(
                    attacker=attacker.name,
                    defender=defender.name,
                    defence=defender.defence,
                    charge_dice=attacker.charge,
                    charge_ap=attacker.charge_ap,
                    charge_ev=charge_ev,
                    charge_kill_pct=100.0 * first_attack_kill_probability(
                        attacker.charge, defender.defence, attacker.charge_ap
                    ),
                    melee_dice=attacker.melee,
                    melee_ap=attacker.melee_ap,
                    melee_ev=melee_ev,
                    melee_attacks_to_kill=expected_repeated_attacks_to_kill(
                        attacker.melee, defender.defence, attacker.melee_ap
                    ),
                    charge_then_melee=expected_charge_then_melee(
                        attacker.charge,
                        attacker.charge_ap,
                        attacker.melee,
                        attacker.melee_ap,
                        defender.defence,
                    ),
                    shoot_dice=shoot_dice,
                    shoot_ap=shoot_ap,
                    shoot_ev=shoot_ev,
                    shoot_attacks_to_kill=shoot_attacks,
                    shoot_kill_pct=shoot_kill_pct,
                )
            )

    return results


def format_number(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return "—"
    if math.isinf(value):
        return "∞"
    return f"{value:.{decimals}f}"


def stat_label(dice: int | None, armour_piercing: bool | None) -> str:
    if dice is None:
        return "—"
    return f"{dice}{'*' if armour_piercing else ''}"


class UnitEditor(ttk.Frame):
    def __init__(self, master: tk.Misc) -> None:
        super().__init__(master, padding=10)
        self.units: list[Unit] = []
        self.selected_index: int | None = None
        self._loading_form = False

        self.variables = {
            "name": tk.StringVar(),
            "move": tk.StringVar(),
            "drill": tk.StringVar(),
            "charge": tk.StringVar(),
            "charge_ap": tk.BooleanVar(),
            "melee": tk.StringVar(),
            "melee_ap": tk.BooleanVar(),
            "shoot": tk.StringVar(),
            "shoot_ap": tk.BooleanVar(),
            "range": tk.StringVar(),
            "defence": tk.StringVar(),
            "analyse_shooting": tk.BooleanVar(),
        }

        self._build()
        self.load_units()

    def _build(self) -> None:
        self.columnconfigure(0, weight=1)
        self.columnconfigure(1, weight=2)
        self.rowconfigure(1, weight=1)

        heading = ttk.Label(
            self,
            text="Seize the Day — EV Matchup Calculator",
            font=("TkDefaultFont", 15, "bold"),
        )
        heading.grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 8))

        left = ttk.LabelFrame(self, text="Units", padding=8)
        left.grid(row=1, column=0, sticky="nsew", padx=(0, 8))
        left.columnconfigure(0, weight=1)
        left.rowconfigure(0, weight=1)

        self.unit_list = tk.Listbox(left, exportselection=False, height=20)
        self.unit_list.grid(row=0, column=0, sticky="nsew")
        list_scroll = ttk.Scrollbar(
            left, orient="vertical", command=self.unit_list.yview
        )
        list_scroll.grid(row=0, column=1, sticky="ns")
        self.unit_list.configure(yscrollcommand=list_scroll.set)
        self.unit_list.bind("<<ListboxSelect>>", self._on_select)

        unit_buttons = ttk.Frame(left)
        unit_buttons.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        ttk.Button(unit_buttons, text="Add", command=self.add_unit).pack(
            side="left", padx=(0, 4)
        )
        ttk.Button(unit_buttons, text="Duplicate", command=self.duplicate_unit).pack(
            side="left", padx=4
        )
        ttk.Button(unit_buttons, text="Delete", command=self.delete_unit).pack(
            side="left", padx=4
        )

        right = ttk.LabelFrame(self, text="Selected unit", padding=10)
        right.grid(row=1, column=1, sticky="nsew")
        right.columnconfigure(1, weight=1)

        fields = [
            ("Name", "name"),
            ("Move", "move"),
            ("Drill", "drill"),
            ("Charge dice", "charge"),
            ("Melee dice", "melee"),
            ("Shoot dice", "shoot"),
            ("Range", "range"),
            ("Defence", "defence"),
        ]
        for row, (label, key) in enumerate(fields):
            ttk.Label(right, text=label).grid(
                row=row, column=0, sticky="w", padx=(0, 8), pady=3
            )
            entry = ttk.Entry(right, textvariable=self.variables[key])
            entry.grid(row=row, column=1, sticky="ew", pady=3)

        ap_frame = ttk.LabelFrame(right, text="Armour Piercing", padding=8)
        ap_frame.grid(row=len(fields), column=0, columnspan=2, sticky="ew", pady=(10, 4))
        ttk.Checkbutton(
            ap_frame, text="Charge", variable=self.variables["charge_ap"]
        ).pack(side="left", padx=(0, 14))
        ttk.Checkbutton(
            ap_frame, text="Melee", variable=self.variables["melee_ap"]
        ).pack(side="left", padx=14)
        ttk.Checkbutton(
            ap_frame, text="Shoot", variable=self.variables["shoot_ap"]
        ).pack(side="left", padx=14)

        ttk.Checkbutton(
            right,
            text="Analyse this unit's shooting matchups",
            variable=self.variables["analyse_shooting"],
        ).grid(
            row=len(fields) + 1,
            column=0,
            columnspan=2,
            sticky="w",
            pady=(8, 4),
        )

        ttk.Label(
            right,
            text=(
                "Only units with this box enabled use their Shoot stat in the "
                "results. Charge and Melee are calculated for every unit."
            ),
            wraplength=480,
            foreground="#555555",
        ).grid(
            row=len(fields) + 2,
            column=0,
            columnspan=2,
            sticky="w",
            pady=(0, 8),
        )

        ttk.Button(right, text="Apply changes", command=self.apply_form).grid(
            row=len(fields) + 3,
            column=0,
            columnspan=2,
            sticky="ew",
            pady=(8, 0),
        )

        bottom = ttk.Frame(self)
        bottom.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(10, 0))

        ttk.Button(bottom, text="Calculate matchups", command=self.calculate).pack(
            side="left"
        )
        ttk.Button(bottom, text="Save profiles", command=self.save_units).pack(
            side="left", padx=6
        )
        ttk.Button(
            bottom, text="Restore defaults", command=self.restore_defaults
        ).pack(side="left", padx=6)

        self.status = ttk.Label(
            bottom,
            text=f"Profiles file: {DATA_FILE}",
            foreground="#555555",
        )
        self.status.pack(side="right")

    def refresh_list(self, select: int | None = None) -> None:
        self.unit_list.delete(0, tk.END)
        for unit in self.units:
            self.unit_list.insert(tk.END, unit.name)

        if self.units:
            index = (
                min(select, len(self.units) - 1)
                if select is not None
                else min(self.selected_index or 0, len(self.units) - 1)
            )
            self.unit_list.selection_set(index)
            self.unit_list.activate(index)
            self.selected_index = index
            self.load_form(self.units[index])
        else:
            self.selected_index = None
            self.clear_form()

    def _on_select(self, _event: tk.Event) -> None:
        selection = self.unit_list.curselection()
        if not selection:
            return
        index = selection[0]
        self.selected_index = index
        self.load_form(self.units[index])

    def load_form(self, unit: Unit) -> None:
        self._loading_form = True
        try:
            for key, variable in self.variables.items():
                variable.set(getattr(unit, key))
        finally:
            self._loading_form = False

    def clear_form(self) -> None:
        for key, variable in self.variables.items():
            variable.set(False if key.endswith("_ap") or key == "analyse_shooting" else "")

    def unit_from_form(self) -> Unit:
        def integer(key: str, minimum: int = 0, maximum: int = 99) -> int:
            raw = self.variables[key].get().strip()
            try:
                value = int(raw)
            except ValueError as exc:
                raise ValueError(f"{key.replace('_', ' ').title()} must be an integer.") from exc
            if not minimum <= value <= maximum:
                raise ValueError(
                    f"{key.replace('_', ' ').title()} must be between "
                    f"{minimum} and {maximum}."
                )
            return value

        name = self.variables["name"].get().strip()
        if not name:
            raise ValueError("Name cannot be empty.")

        return Unit(
            name=name,
            move=integer("move"),
            drill=integer("drill", 0, 9),
            charge=integer("charge", 0, 30),
            charge_ap=bool(self.variables["charge_ap"].get()),
            melee=integer("melee", 0, 30),
            melee_ap=bool(self.variables["melee_ap"].get()),
            shoot=integer("shoot", 0, 30),
            shoot_ap=bool(self.variables["shoot_ap"].get()),
            range=integer("range", 0, 99),
            defence=integer("defence", 1, 7),
            analyse_shooting=bool(self.variables["analyse_shooting"].get()),
        )

    def apply_form(self, quiet: bool = False) -> bool:
        if self.selected_index is None:
            return True
        try:
            unit = self.unit_from_form()
        except ValueError as exc:
            if not quiet:
                messagebox.showerror("Invalid profile", str(exc), parent=self)
            return False

        self.units[self.selected_index] = unit
        self.refresh_list(self.selected_index)
        if not quiet:
            self.status.configure(text=f"Updated {unit.name}")
        return True

    def add_unit(self) -> None:
        if not self.apply_form(quiet=True):
            return
        new_unit = Unit.from_dict({"name": f"New Unit {len(self.units) + 1}"})
        self.units.append(new_unit)
        self.refresh_list(len(self.units) - 1)

    def duplicate_unit(self) -> None:
        if self.selected_index is None:
            return
        if not self.apply_form(quiet=True):
            return
        original = self.units[self.selected_index]
        duplicate = Unit.from_dict(asdict(original))
        duplicate.name = f"{original.name} Copy"
        self.units.insert(self.selected_index + 1, duplicate)
        self.refresh_list(self.selected_index + 1)

    def delete_unit(self) -> None:
        if self.selected_index is None:
            return
        unit = self.units[self.selected_index]
        if not messagebox.askyesno(
            "Delete unit",
            f"Delete {unit.name}?",
            parent=self,
        ):
            return
        old_index = self.selected_index
        del self.units[old_index]
        self.refresh_list(max(0, old_index - 1))

    def load_units(self) -> None:
        if DATA_FILE.exists():
            try:
                raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
                self.units = [Unit.from_dict(item) for item in raw]
                self.status.configure(text=f"Loaded profiles from {DATA_FILE}")
            except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
                messagebox.showwarning(
                    "Could not load profiles",
                    f"{DATA_FILE}\n\n{exc}\n\nDefaults have been loaded.",
                    parent=self,
                )
                self.units = [Unit.from_dict(item) for item in DEFAULT_UNITS]
        else:
            self.units = [Unit.from_dict(item) for item in DEFAULT_UNITS]
        self.refresh_list(0)

    def save_units(self, show_message: bool = True) -> bool:
        if not self.apply_form(quiet=not show_message):
            return False
        try:
            DATA_FILE.write_text(
                json.dumps([asdict(unit) for unit in self.units], indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            messagebox.showerror(
                "Could not save profiles",
                f"{DATA_FILE}\n\n{exc}",
                parent=self,
            )
            return False

        self.status.configure(text=f"Saved profiles to {DATA_FILE}")
        if show_message:
            messagebox.showinfo(
                "Profiles saved",
                f"Saved to:\n{DATA_FILE}",
                parent=self,
            )
        return True

    def restore_defaults(self) -> None:
        if not messagebox.askyesno(
            "Restore defaults",
            "Replace all current profiles with the built-in defaults?",
            parent=self,
        ):
            return
        self.units = [Unit.from_dict(item) for item in DEFAULT_UNITS]
        self.refresh_list(0)
        self.save_units(show_message=False)
        self.status.configure(text="Restored and saved default profiles")

    def calculate(self) -> None:
        if not self.apply_form():
            return
        if not self.units:
            messagebox.showerror("No units", "Add at least one unit.", parent=self)
            return
        self.save_units(show_message=False)
        results = calculate_matchups(self.units)
        ResultsWindow(self, self.units, results)


class ResultsWindow(tk.Toplevel):
    COLUMNS = (
        "defender",
        "def",
        "charge",
        "charge_ev",
        "charge_kill",
        "charge_melee",
        "melee",
        "melee_ev",
        "melee_kill",
        "shoot",
        "shoot_ev",
        "shoot_kill",
        "shoot_one_kill",
    )

    HEADINGS = {
        "defender": "Defender",
        "def": "Def",
        "charge": "Charge",
        "charge_ev": "Charge EV",
        "charge_kill": "Charge kill %",
        "charge_melee": "Charge→Melee acts",
        "melee": "Melee",
        "melee_ev": "Melee EV",
        "melee_kill": "Melee acts",
        "shoot": "Shoot",
        "shoot_ev": "Shoot EV",
        "shoot_kill": "Shoot acts",
        "shoot_one_kill": "Shoot kill %",
    }

    WIDTHS = {
        "defender": 150,
        "def": 45,
        "charge": 65,
        "charge_ev": 80,
        "charge_kill": 90,
        "charge_melee": 125,
        "melee": 65,
        "melee_ev": 75,
        "melee_kill": 85,
        "shoot": 65,
        "shoot_ev": 75,
        "shoot_kill": 85,
        "shoot_one_kill": 85,
    }

    def __init__(
        self,
        master: tk.Misc,
        units: list[Unit],
        results: list[MatchupResult],
    ) -> None:
        super().__init__(master)
        self.title("Seize the Day — Matchup Results")
        self.geometry("1280x720")
        self.minsize(900, 500)

        self.units = units
        self.results = results

        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        summary = ttk.Label(
            self,
            text=(
                "Exact expectations for 7 HP, no exploding sixes. "
                "Armour Piercing caps the required roll at 3+. "
                "Charge→Melee uses Charge once, then Melee repeatedly."
            ),
            padding=(10, 10, 10, 4),
            wraplength=1200,
        )
        summary.grid(row=0, column=0, sticky="ew")

        notebook = ttk.Notebook(self)
        notebook.grid(row=1, column=0, sticky="nsew", padx=10, pady=6)

        by_attacker: dict[str, list[MatchupResult]] = {}
        for result in results:
            by_attacker.setdefault(result.attacker, []).append(result)

        for unit in units:
            frame = ttk.Frame(notebook, padding=6)
            notebook.add(frame, text=unit.name)
            self._add_attacker_table(frame, by_attacker[unit.name])

        controls = ttk.Frame(self, padding=(10, 4, 10, 10))
        controls.grid(row=2, column=0, sticky="ew")
        ttk.Button(
            controls, text="Export all results to CSV", command=self.export_csv
        ).pack(side="left")
        ttk.Button(controls, text="Close", command=self.destroy).pack(side="right")

    def _add_attacker_table(
        self,
        parent: ttk.Frame,
        rows: list[MatchupResult],
    ) -> None:
        parent.columnconfigure(0, weight=1)
        parent.rowconfigure(1, weight=1)

        attacker = rows[0].attacker if rows else ""
        unit = next(unit for unit in self.units if unit.name == attacker)
        profile_text = (
            f"Move {unit.move} · Drill {unit.drill} · "
            f"Charge {stat_label(unit.charge, unit.charge_ap)} · "
            f"Melee {stat_label(unit.melee, unit.melee_ap)} · "
            f"Defence {unit.defence}"
        )
        if unit.analyse_shooting and unit.shoot > 0:
            profile_text += (
                f" · Shoot {stat_label(unit.shoot, unit.shoot_ap)}/{unit.range}"
            )

        ttk.Label(parent, text=profile_text).grid(
            row=0, column=0, sticky="w", pady=(0, 6)
        )

        table_frame = ttk.Frame(parent)
        table_frame.grid(row=1, column=0, sticky="nsew")
        table_frame.columnconfigure(0, weight=1)
        table_frame.rowconfigure(0, weight=1)

        tree = ttk.Treeview(
            table_frame,
            columns=self.COLUMNS,
            show="headings",
            selectmode="browse",
        )
        tree.grid(row=0, column=0, sticky="nsew")

        vertical = ttk.Scrollbar(
            table_frame, orient="vertical", command=tree.yview
        )
        vertical.grid(row=0, column=1, sticky="ns")
        horizontal = ttk.Scrollbar(
            table_frame, orient="horizontal", command=tree.xview
        )
        horizontal.grid(row=1, column=0, sticky="ew")
        tree.configure(
            yscrollcommand=vertical.set,
            xscrollcommand=horizontal.set,
        )

        for column in self.COLUMNS:
            tree.heading(column, text=self.HEADINGS[column])
            anchor = "w" if column == "defender" else "center"
            tree.column(
                column,
                width=self.WIDTHS[column],
                minwidth=40,
                anchor=anchor,
                stretch=(column == "defender"),
            )

        for row in rows:
            tree.insert(
                "",
                tk.END,
                values=(
                    row.defender,
                    row.defence,
                    stat_label(row.charge_dice, row.charge_ap),
                    format_number(row.charge_ev),
                    format_number(row.charge_kill_pct, 1),
                    format_number(row.charge_then_melee),
                    stat_label(row.melee_dice, row.melee_ap),
                    format_number(row.melee_ev),
                    format_number(row.melee_attacks_to_kill),
                    stat_label(row.shoot_dice, row.shoot_ap),
                    format_number(row.shoot_ev),
                    format_number(row.shoot_attacks_to_kill),
                    format_number(row.shoot_kill_pct, 1),
                ),
            )

    def export_csv(self) -> None:
        path = filedialog.asksaveasfilename(
            parent=self,
            title="Export matchup results",
            defaultextension=".csv",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not path:
            return

        headers = [
            "Attacker",
            "Defender",
            "Defence",
            "Charge stat",
            "Charge expected wounds",
            "Charge one-attack kill %",
            "Charge then melee expected activations",
            "Melee stat",
            "Melee expected wounds",
            "Melee expected activations",
            "Shoot stat",
            "Shoot expected wounds",
            "Shoot expected activations",
            "Shoot one-attack kill %",
        ]

        try:
            with open(path, "w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(headers)
                for row in self.results:
                    writer.writerow(
                        [
                            row.attacker,
                            row.defender,
                            row.defence,
                            stat_label(row.charge_dice, row.charge_ap),
                            format_number(row.charge_ev, 4),
                            format_number(row.charge_kill_pct, 4),
                            format_number(row.charge_then_melee, 4),
                            stat_label(row.melee_dice, row.melee_ap),
                            format_number(row.melee_ev, 4),
                            format_number(row.melee_attacks_to_kill, 4),
                            stat_label(row.shoot_dice, row.shoot_ap),
                            format_number(row.shoot_ev, 4),
                            format_number(row.shoot_attacks_to_kill, 4),
                            format_number(row.shoot_kill_pct, 4),
                        ]
                    )
        except OSError as exc:
            messagebox.showerror(
                "Could not export CSV",
                str(exc),
                parent=self,
            )
            return

        messagebox.showinfo(
            "CSV exported",
            f"Saved to:\n{path}",
            parent=self,
        )


class App(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Seize the Day — EV Matchup Calculator")
        self.geometry("920x650")
        self.minsize(760, 560)

        editor = UnitEditor(self)
        editor.pack(fill="both", expand=True)
        self.editor = editor

        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def on_close(self) -> None:
        if self.editor.apply_form(quiet=True):
            self.editor.save_units(show_message=False)
        self.destroy()


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
