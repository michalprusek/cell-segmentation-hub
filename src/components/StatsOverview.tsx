
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Microscope, Image, FileUp, FileClock } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

const StatCard = ({ title, value, description, icon, trend }: StatCardProps) => (
  <Card className="transition-all duration-300 hover:shadow-md">
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-500">{title}</CardTitle>
      <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
        {icon}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      <p className="text-xs text-gray-500 mt-1">{description}</p>
      {trend && (
        <div className={`text-xs mt-2 flex items-center ${trend.isPositive ? 'text-green-600' : 'text-red-600'}`}>
          <span>{trend.value}</span>
          <svg 
            className={`h-3 w-3 ml-1 ${!trend.isPositive && 'rotate-180'}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </div>
      )}
    </CardContent>
  </Card>
);

const StatsOverview = () => {
  const stats = [
    {
      title: "Total Projects",
      value: "12",
      description: "Active spheroid studies",
      icon: <Microscope size={16} />,
      trend: {
        value: "2 new this month",
        isPositive: true
      }
    },
    {
      title: "Processed Images",
      value: "189",
      description: "Successfully segmented",
      icon: <Image size={16} />,
      trend: {
        value: "24% from last week",
        isPositive: true
      }
    },
    {
      title: "Uploaded Today",
      value: "7",
      description: "Spheroid images pending",
      icon: <FileUp size={16} />,
    },
    {
      title: "Segmentation Time",
      value: "2.7s",
      description: "Average per image",
      icon: <FileClock size={16} />,
      trend: {
        value: "0.3s faster than before",
        isPositive: true
      }
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} />
      ))}
    </div>
  );
};

export default StatsOverview;
