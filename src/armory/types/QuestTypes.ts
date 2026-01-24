export interface IQuest {
	id: number;
	title: string;
	status: 'Completed' | 'In Progress';
	minLevel: number;
	questLevel: number;
	questSortID: number;
}

export interface IQuestComparison {
	id: number;
	title: string;
	questLevel: number;
	char1Status?: 'Completed' | 'In Progress';
	char2Status?: 'Completed' | 'In Progress';
	category?: string;
}