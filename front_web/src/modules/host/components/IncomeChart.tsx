import {
	Bar,
	BarChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { Period } from "../types";
import { formatPeriod, hasMultipleYears } from "../utils/formatStats";

interface IncomeChartProps {
	periods: Period[];
}

export function IncomeChart({ periods }: IncomeChartProps) {
	if (periods.length === 0) {
		return (
			<div className="mt-8 flex min-h-52 items-center justify-center rounded-lg border border-line border-dashed bg-canvas px-6 text-center">
				<div>
					<h3 className="font-black text-2xl text-ink">No income yet</h3>
					<p className="mx-auto mt-3 max-w-md font-medium text-muted leading-7">
						Completed trips will appear here once guests finish their stays.
					</p>
				</div>
			</div>
		);
	}

	const showChartYears = hasMultipleYears(periods);

	return (
		<div className="mt-10 h-64">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart data={periods}>
					<CartesianGrid stroke="#ded3c4" vertical={false} />
					<XAxis
						dataKey="period"
						axisLine={false}
						tickLine={false}
						tickFormatter={(period) => formatPeriod(period, showChartYears)}
						tick={{ fill: "#6f675c", fontSize: 12, fontWeight: 600 }}
					/>
					<YAxis
						axisLine={false}
						tickLine={false}
						tick={{ fill: "#6f675c", fontSize: 12, fontWeight: 600 }}
						tickFormatter={(value) => `$${value}`}
					/>
					<Tooltip
						cursor={{ fill: "#efe6d8" }}
						formatter={(value) => [`$${value}`, "Income"]}
						labelFormatter={(period) => formatPeriod(String(period), true)}
						contentStyle={{
							background: "#fffaf3",
							border: "1px solid #ded3c4",
							borderRadius: "0.5rem",
							color: "#1e1b16",
						}}
					/>
					<Bar dataKey="income" fill="#c86f45" radius={[8, 8, 0, 0]} />
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
